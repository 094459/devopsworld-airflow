# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

# Inspired by https://github.com/dacort/demo-code/blob/main/cdk/big-data-stack/stacks/eks.py

from aws_cdk import (
    aws_eks as eks,
    aws_ec2 as ec2,
    aws_iam as iam,
    Tags,
    Stack,
    CfnJson,
    CfnOutput,
    Aws,
)
import json
from constructs import Construct

class AirflowCdkStackEKS(Stack):

    def __init__(self, scope: Construct, id: str, airflow_props, vpc, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)


        tags = {
            'env': f"{airflow_props['airflow_env']}-dev",
            'service': 'EKS Apache AirFlow'
        }

        env_namespace = f"{airflow_props['airflow_env']}"

        eks_role = iam.Role(
            self,
            "airflow-eksadmin",
            assumed_by=iam.ServicePrincipal(service='ec2.amazonaws.com'),
            role_name='airflow-eks-cluster-role', 
            managed_policies=[iam.ManagedPolicy.from_aws_managed_policy_name(managed_policy_name='AdministratorAccess')]
            )

        cluster = eks.Cluster(
            self,
            "Airflow-EKS",
            vpc=vpc,
            version=eks.KubernetesVersion.V1_20,
            default_capacity_instance=ec2.InstanceType("m5.large"),
            default_capacity=1,
            endpoint_access=eks.EndpointAccess.PUBLIC_AND_PRIVATE,
            vpc_subnets=[ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_NAT)],
            masters_role=eks_role
            )

        ng = cluster.add_nodegroup_capacity(
            "x86",
            desired_size=1, 
            #instance_type=ec2.InstanceType("m6.large"),
            instance_types=[ec2.InstanceType(it) for it in ['c4.2xlarge', 'c5.2xlarge', 'c5d.2xlarge', 'c5a.2xlarge', 'c5n.2xlarge']],
            nodegroup_name="x86",
            node_role=cluster.default_nodegroup.role
            )

        cluster.default_nodegroup.role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name("SecretsManagerReadWrite"))

        self.add_service_account(
            cluster=cluster,
            name="airflow-eks-aws-load-balancer-controller", 
            namespace="kube-system"
            )
        
        cluster.add_helm_chart(
            "LBIngress",
            chart="aws-load-balancer-controller",
            release="aws-load-balancer-controller",
            repository="https://aws.github.io/eks-charts",
            namespace="kube-system",
            values={"clusterName": cluster.cluster_name, "serviceAccount.name": "aws-load-balancer-controller", "serviceAccount.create": "false" })

        # Deploy Apache Airflow via Helm

        self.add_admin_role_to_cluster()

        cluster.add_manifest(
            "eks-admin-sa",
            {
                "apiVersion": "v1",
                "kind": "ServiceAccount",
                "metadata": {
                    "name": "eks-admin",
                    "namespace": "kube-system",
                },
            },
        )
        
        cluster.add_manifest(
            "eks-admin-rbac",
            {
                "apiVersion": "rbac.authorization.k8s.io/v1beta1",
                "kind": "ClusterRoleBinding",
                "metadata": {"name": "eks-admin"},
                "roleRef": {
                    "apiGroup": "rbac.authorization.k8s.io",
                    "kind": "ClusterRole",
                    "name": "cluster-admin",
                },
                "subjects": [
                    {
                        "kind": "ServiceAccount",
                        "name": "eks-admin",
                        "namespace": "kube-system",
                    }
                ],
            },
        )

        ns = cluster.add_manifest(
            "airflow-namespace",
            {"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": env_namespace}},
            )
        service_role = cluster.add_service_account(
            "AirflowServiceAccount",
            namespace=env_namespace
            )
        service_role.node.add_dependency(ns)

        cluster.add_manifest("multiaz-volume", self.gp2_multiazvolume())
        cluster.add_helm_chart(
            "airflow",
            namespace=env_namespace,
            chart="airflow",
            repository="https://airflow-helm.github.io/charts",
            version="8.6.0",
            values={
                "airflow": {
                    "config": {
                        "AIRFLOW__LOGGING__REMOTE_LOGGING": "False",
                        "AIRFLOW__CORE__LOAD_EXAMPLES" : "False",
                        "AIRFLOW__CORE__PLUGINS_FOLDER" : "/opt/airflow/dags/repo/plugins"

                    },
                    "users": {
                        "username" : "admin",
                        "password" : "admin",
                        "role" : "Admin",
                        "email" : "admin@example.com",
                        "firstName" : "admin",
                        "lastName" : "admin"
                    },
                    "executor": "CeleryExecutor",
                    "image": {
                        "repository": "704533066374.dkr.ecr.eu-west-3.amazonaws.com/airflow",
                        "tag": "1.0.24",
                        "pullPolicy": "IfNotPresent",
                    },
                    "extraEnv": [
                        {
                            "name": "AIRFLOW__CORE__FERNET_KEY",
                            "valueFrom": {
                                "secretKeyRef": {
                                    "name": "airflow-fernet-key",
                                    "key": "value",
                                }
                            },
                        },
                        {
                            "name": "AWS_DEFAULT_REGION",
                            "value": Aws.REGION,
                        },
                    ],
                },
                "web": {"resources": {"limits": {"cpu": "1", "memory": "1Gi"}}},
                "workers": {"enabled": False},
                "flower": {"enabled": False},
                "redis": {"enabled": False},
                "dags": {
                    "gitSync": {
                        "enabled": True,
                        "repo": "https://git-codecommit.eu-west-3.amazonaws.com/v1/repos/airflow-dags-cicd-demo",
                        "branch": "main",
                        "revision": "HEAD",
                        "repoSubPath" : "dags",
                        "syncWait" : 60,
                        "httpSecret" : "airflow-http-codecommit-secret",
                        "httpSecretUsernameKey" : "username",
                        "httpSecretPasswordKey" : "password",
                        "resources": {"requests": {"cpu": "50m", "memory": "64Mi"}},
                    }
                },
                "postgresql": {"persistence": {"storageClass": "multiazvolume"}},
                "serviceAccount": {
                    "create": False,
                    "name": service_role.service_account_name,
                    "annotations": {
                        "eks.amazonaws.com/role-arn": service_role.role.role_arn
                    },
                },
            },
        )





    def add_service_account(self, cluster, name, namespace):
        """
        workaround to add helm role to service account
        
        """
        # create role 
        conditions = CfnJson(self, 'ConditionJson',
          value = {
            "%s:aud" % cluster.cluster_open_id_connect_issuer : "sts.amazonaws.com",
            "%s:sub" % cluster.cluster_open_id_connect_issuer : "system:serviceaccount:%s:%s" % (namespace, name),
          },
        )
        principal = iam.OpenIdConnectPrincipal(cluster.open_id_connect_provider).with_conditions({
          "StringEquals": conditions,
        })
        role = iam.Role(self, 'ServiceAccountRole', assumed_by=principal)
        
        # create policy for the service account
        statements = []
        with open('airflow_cdk/iam_policy.json') as f:
            data = json.load(f)
            for s in data["Statement"]:
                statements.append(iam.PolicyStatement.from_json(s))
        policy = iam.Policy(self, "LBControllerPolicy", statements=statements)
        policy.attach_to_role(role)
    
        return eks.KubernetesManifest(self, "ServiceAccount", cluster=cluster,
          manifest=[{
            "apiVersion": "v1",
            "kind": "ServiceAccount",
            "metadata": {
              "name": name, 
              "namespace": namespace ,
              "labels": {
                "app.kubernetes.io/name": name, 
                "app.kubernetes.io/managed-by": "Helm",
              },
              "annotations": {
                "eks.amazonaws.com/role-arn": role.role_arn,
                "meta.helm.sh/release-name": name, 
                "meta.helm.sh/release-namespace": namespace, 
              },
            },
          }],
        )

    def gp2_multiazvolume(self):
        return {
            "kind": "StorageClass",
            "apiVersion": "storage.k8s.io/v1",
            "metadata": {"name": "multiazvolume"},
            "provisioner": "kubernetes.io/aws-ebs",
            "parameters": {"type": "gp2", "iopsPerGB": "10", "fsType": "ext4"},
            "volumeBindingMode": "WaitForFirstConsumer",
        }

    def add_admin_role_to_cluster(self) -> None:
        admin_role_name = self.node.try_get_context("eks_admin_role_name")
        if admin_role_name is None:
            return

        account_id = Aws.ACCOUNT_ID
        admin_role = iam.Role.from_role_arn(
            self, "admin_role", f"arn:aws:iam::{account_id}:role/{admin_role_name}"
        )
        self.cluster.aws_auth.add_masters_role(admin_role)