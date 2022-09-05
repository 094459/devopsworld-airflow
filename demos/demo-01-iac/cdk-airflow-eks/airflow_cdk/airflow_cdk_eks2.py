# Inspired by
#  https://dev.to/aws-builders/apache-airflow-in-eks-cluster-dgo
#  https://github.com/aws-quickstart/quickstart-eks-cdk-python
#  https://github.com/dacort/demo-code/blob/main/cdk/big-data-stack/stacks/eks.py

from aws_cdk import (
    aws_eks as eks,
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_efs as efs,
    aws_secretsmanager as sm,
    aws_certificatemanager as acm,
    aws_route53 as route53,
    Stack,
    CfnOutput,
    Aws,
    RemovalPolicy
)
import yaml
import base64
from constructs import Construct

class AirflowCdkStackEKS2(Stack):

    def __init__(self, scope: Construct, id: str, airflow_props, vpc, certificate, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)


        tags = {
            'env': f"{airflow_props['airflow_env']}-dev",
            'service': 'EKS Apache AirFlow'
        }

        env_namespace = f"{airflow_props['airflow_env']}"

        eks_cluster_admin_role = iam.Role(
            self,
            "ClusterAdminRole",
            assumed_by=iam.CompositePrincipal(iam.AccountRootPrincipal(), iam.ServicePrincipal("ec2.amazonaws.com"))
            )
        
        cluster_admin_policy_statement_json_1 = {
                "Effect": "Allow",
                "Action": [
                    "eks:DescribeCluster"
                ],
                "Resource": "*"
            }
        
        eks_cluster_admin_role.add_to_principal_policy(
                iam.PolicyStatement.from_json(cluster_admin_policy_statement_json_1))
               
        cluster = eks.Cluster(
            self,
            "Airflow-EKS",
            vpc=vpc,
            version=eks.KubernetesVersion.V1_20,
            default_capacity_instance=ec2.InstanceType("m5.large"),
            default_capacity=1,
            endpoint_access=eks.EndpointAccess.PUBLIC_AND_PRIVATE,
            vpc_subnets=[ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_WITH_NAT)],
            masters_role=eks_cluster_admin_role
            )

        #admin_user = iam.User(self, "ops") ##use if you do want to create a new user
        admin_user = iam.User.from_user_name(self,"Existing EKS Admin User", "ops")     
        cluster.aws_auth.add_user_mapping(admin_user, groups=["system:masters"])

        ng = cluster.add_nodegroup_capacity(
            "x86",
            desired_size=1, 
            instance_types=[ec2.InstanceType(it) for it in ['c4.2xlarge', 'c5.2xlarge', 'c5d.2xlarge', 'c5a.2xlarge', 'c5n.2xlarge']],
            nodegroup_name="x86",
            node_role=cluster.default_nodegroup.role
            )

        ng.role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name("SecretsManagerReadWrite"))
        ng.role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name("AmazonSSMManagedInstanceCore"))

        # Setup AWS Application Load Balancer
        
        # Grab the cert that we generated in the util stack as we will use that when
        # creating the ALB

        certarn = certificate.certificate_arn
        albcertarn = acm.Certificate.from_certificate_arn(
            self,
            "Certificate",
            certarn)
        

        awslbcontroller_service_account = cluster.add_service_account(
                "aws-load-balancer-controller",
                name="aws-load-balancer-controller",
                namespace="kube-system"
            )

        awslbcontroller_policy_document_json = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Action": [
                            "iam:CreateServiceLinkedRole",
                            "ec2:DescribeAccountAttributes",
                            "ec2:DescribeAddresses",
                            "ec2:DescribeAvailabilityZones",
                            "ec2:DescribeInternetGateways",
                            "ec2:DescribeVpcs",
                            "ec2:DescribeSubnets",
                            "ec2:DescribeSecurityGroups",
                            "ec2:DescribeInstances",
                            "ec2:DescribeNetworkInterfaces",
                            "ec2:DescribeTags",
                            "ec2:GetCoipPoolUsage",
                            "ec2:DescribeCoipPools",
                            "elasticloadbalancing:DescribeLoadBalancers",
                            "elasticloadbalancing:DescribeLoadBalancerAttributes",
                            "elasticloadbalancing:DescribeListeners",
                            "elasticloadbalancing:DescribeListenerCertificates",
                            "elasticloadbalancing:DescribeSSLPolicies",
                            "elasticloadbalancing:DescribeRules",
                            "elasticloadbalancing:DescribeTargetGroups",
                            "elasticloadbalancing:DescribeTargetGroupAttributes",
                            "elasticloadbalancing:DescribeTargetHealth",
                            "elasticloadbalancing:DescribeTags"
                        ],
                        "Resource": "*"
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "cognito-idp:DescribeUserPoolClient",
                            "acm:ListCertificates",
                            "acm:DescribeCertificate",
                            "iam:ListServerCertificates",
                            "iam:GetServerCertificate",
                            "waf-regional:GetWebACL",
                            "waf-regional:GetWebACLForResource",
                            "waf-regional:AssociateWebACL",
                            "waf-regional:DisassociateWebACL",
                            "wafv2:GetWebACL",
                            "wafv2:GetWebACLForResource",
                            "wafv2:AssociateWebACL",
                            "wafv2:DisassociateWebACL",
                            "shield:GetSubscriptionState",
                            "shield:DescribeProtection",
                            "shield:CreateProtection",
                            "shield:DeleteProtection"
                        ],
                        "Resource": "*"
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "ec2:AuthorizeSecurityGroupIngress",
                            "ec2:RevokeSecurityGroupIngress"
                        ],
                        "Resource": "*"
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "ec2:CreateSecurityGroup"
                        ],
                        "Resource": "*"
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "ec2:CreateTags"
                        ],
                        "Resource": "arn:aws:ec2:*:*:security-group/*",
                        "Condition": {
                            "StringEquals": {
                                "ec2:CreateAction": "CreateSecurityGroup"
                            },
                            "Null": {
                                "aws:RequestTag/elbv2.k8s.aws/cluster": "false"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "ec2:CreateTags",
                            "ec2:DeleteTags"
                        ],
                        "Resource": "arn:aws:ec2:*:*:security-group/*",
                        "Condition": {
                            "Null": {
                                "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
                                "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "ec2:AuthorizeSecurityGroupIngress",
                            "ec2:RevokeSecurityGroupIngress",
                            "ec2:DeleteSecurityGroup"
                        ],
                        "Resource": "*",
                        "Condition": {
                            "Null": {
                                "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "elasticloadbalancing:CreateLoadBalancer",
                            "elasticloadbalancing:CreateTargetGroup"
                        ],
                        "Resource": "*",
                        "Condition": {
                            "Null": {
                                "aws:RequestTag/elbv2.k8s.aws/cluster": "false"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "elasticloadbalancing:CreateListener",
                            "elasticloadbalancing:DeleteListener",
                            "elasticloadbalancing:CreateRule",
                            "elasticloadbalancing:DeleteRule"
                        ],
                        "Resource": "*"
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "elasticloadbalancing:AddTags",
                            "elasticloadbalancing:RemoveTags"
                        ],
                        "Resource": [
                            "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*",
                            "arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*",
                            "arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*"
                        ],
                        "Condition": {
                            "Null": {
                                "aws:RequestTag/elbv2.k8s.aws/cluster": "true",
                                "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "elasticloadbalancing:AddTags",
                            "elasticloadbalancing:RemoveTags"
                        ],
                        "Resource": [
                            "arn:aws:elasticloadbalancing:*:*:listener/net/*/*/*",
                            "arn:aws:elasticloadbalancing:*:*:listener/app/*/*/*",
                            "arn:aws:elasticloadbalancing:*:*:listener-rule/net/*/*/*",
                            "arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*"
                        ]
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "elasticloadbalancing:ModifyLoadBalancerAttributes",
                            "elasticloadbalancing:SetIpAddressType",
                            "elasticloadbalancing:SetSecurityGroups",
                            "elasticloadbalancing:SetSubnets",
                            "elasticloadbalancing:DeleteLoadBalancer",
                            "elasticloadbalancing:ModifyTargetGroup",
                            "elasticloadbalancing:ModifyTargetGroupAttributes",
                            "elasticloadbalancing:DeleteTargetGroup"
                        ],
                        "Resource": "*",
                        "Condition": {
                            "Null": {
                                "aws:ResourceTag/elbv2.k8s.aws/cluster": "false"
                            }
                        }
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "elasticloadbalancing:RegisterTargets",
                            "elasticloadbalancing:DeregisterTargets"
                        ],
                        "Resource": "arn:aws:elasticloadbalancing:*:*:targetgroup/*/*"
                    },
                    {
                        "Effect": "Allow",
                        "Action": [
                            "elasticloadbalancing:SetWebAcl",
                            "elasticloadbalancing:ModifyListener",
                            "elasticloadbalancing:AddListenerCertificates",
                            "elasticloadbalancing:RemoveListenerCertificates",
                            "elasticloadbalancing:ModifyRule"
                        ],
                        "Resource": "*"
                    }
                ]
            }

        awslbcontroller_policy = iam.Policy(
                self, "awslbcontrollerpolicy",
                document=iam.PolicyDocument.from_json(awslbcontroller_policy_document_json)
            )
        awslbcontroller_service_account.role.attach_inline_policy(
                awslbcontroller_policy)

        awslbcontroller_chart = cluster.add_helm_chart(
                "aws-load-balancer-controller",
                chart="aws-load-balancer-controller",
                #version="1.4.2",
                version="1.4.3",
                #release="awslbcontroller",
                release="aws-load-balancer-controller",
                #repository="https://602401143452.dkr.ecr.us-east-2.amazonaws.com/amazon/aws-load-balancer-controller:v2.4.2",
                repository="https://aws.github.io/eks-charts",
                namespace="kube-system",
                values={
                    "clusterName": cluster.cluster_name,
                    "region": self.region,
                    "vpcId": vpc.vpc_id,
                    "serviceAccount": {
                        "create": False,
                        "name": "aws-load-balancer-controller"
                    },
                    "replicaCount": 2,
                    "podDisruptionBudget": {
                        "maxUnavailable": 1
                    },
                    "resources": {
                        "requests": {
                            "cpu": "0.25",
                            "memory": "0.5Gi"
                        }
                    }
                }
            )
        awslbcontroller_chart.node.add_dependency(
                awslbcontroller_service_account)

       # Configure EFS

        awsefscsidriver_service_account = cluster.add_service_account(
                        "awsefscsidriver",
                        name="awsefscsidriver",
                        namespace="kube-system"
                    )

        awsefscsidriver_policy_statement_json_1 = {
                "Effect": "Allow",
                "Action": [
                    "elasticfilesystem:DescribeAccessPoints",
                    "elasticfilesystem:DescribeFileSystems"
                ],
                "Resource": "*"
            }
        awsefscsidriver_policy_statement_json_2 = {
                "Effect": "Allow",
                "Action": [
                    "elasticfilesystem:CreateAccessPoint"
                ],
                "Resource": "*",
                "Condition": {
                    "StringLike": {
                        "aws:RequestTag/efs.csi.aws.com/cluster": "true"
                    }
                }
            }
        awsefscsidriver_policy_statement_json_3 = {
                "Effect": "Allow",
                "Action": "elasticfilesystem:DeleteAccessPoint",
                "Resource": "*",
                "Condition": {
                    "StringEquals": {
                        "aws:ResourceTag/efs.csi.aws.com/cluster": "true"
                    }
                }
            }

        # Attach the necessary permissions

        awsefscsidriver_service_account.add_to_principal_policy(
                iam.PolicyStatement.from_json(awsefscsidriver_policy_statement_json_1))
        awsefscsidriver_service_account.add_to_principal_policy(
                iam.PolicyStatement.from_json(awsefscsidriver_policy_statement_json_2))
        awsefscsidriver_service_account.add_to_principal_policy(
                iam.PolicyStatement.from_json(awsefscsidriver_policy_statement_json_3))

        # Install EFS Helm Chart

        awsefscsi_chart = cluster.add_helm_chart(
                "aws-efs-csi-driver",
                chart="aws-efs-csi-driver",
                version="2.2.3",
                release="awsefscsidriver",
                repository="https://kubernetes-sigs.github.io/aws-efs-csi-driver/",
                namespace="kube-system",
                values={
                    "controller": {
                        "serviceAccount": {
                            "create": False,
                            "name": "awsefscsidriver"
                        },
                        "deleteAccessPointRootDir": True
                    },
                    "node": {
                        "serviceAccount": {
                            "create": False,
                            "name": "awsefscsidriver"
                        }
                    }
                }
            )
        awsefscsi_chart.node.add_dependency(awsefscsidriver_service_account)

        # Enable EFS connectivity between nodes
        efs_security_group = ec2.SecurityGroup(
                self, "EFSSecurityGroup",
                vpc=vpc,
                allow_all_outbound=True
            )
        # Add a rule to allow the EKS Nodes to talk to our new EFS (will not work with SGs for Pods by default)
        efs_security_group.add_ingress_rule(
                cluster.cluster_security_group,
                ec2.Port.tcp(2049)
            )
        efs_filesystem = efs.FileSystem(
                self, "EFSFilesystem",
                vpc=vpc,
                security_group=efs_security_group,
                removal_policy=RemovalPolicy.DESTROY
            )

        efs_csi_storageclass = cluster.add_manifest("EFSCSIStorageClass", {
                "kind": "StorageClass",
                "apiVersion": "storage.k8s.io/v1",
                "metadata": {
                    "name": "efs"
                },
                "provisioner": "efs.csi.aws.com",
                "parameters": {
                    "provisioningMode": "efs-ap",
                    "fileSystemId": efs_filesystem.file_system_id,
                    "directoryPerms": "700",
                    "gidRangeStart": "1000",
                    "gidRangeEnd": "2000",
                    "basePath": "/dynamic_provisioning"
                }
            })

        efs_csi_storageclass.node.add_dependency(awsefscsi_chart)

        # Deploy Airflow
        # use version 1.0.26 of the ECR image which is known working if all else fails
        # change the "pullPolicy": "IfNotPresent" to "Always" during testing

        airflow = cluster.add_helm_chart(
                "eks-airflow-cluster",
                chart="airflow",
                version="8.6.0",
                release="eks-airflow-cluster",
                repository="https://airflow-helm.github.io/charts",
                namespace="eks-airflow-cluster",
                values={
                    "airflow": {
                        "legacyCommands": False,
                        "image": {
                        "repository": "704533066374.dkr.ecr.us-east-2.amazonaws.com/airflow",
                        "tag": "1.0.29",
                        "pullPolicy": "Always"
                        },
                        "executor": "CeleryExecutor",
                        #"fernetKey": "${fernet}",
                        #"webserverSecretKey": "${webserverSecretKey}",
                        "config": {
                        "AIRFLOW__WEBSERVER__EXPOSE_CONFIG": "False",
                        "AIRFLOW__CORE__LOAD_EXAMPLES": "False",
                        "AIRFLOW__CORE__PLUGINS_FOLDER": "/opt/airflow/dags/repo/plugins"
                        },
                        "users": [
                        {
                            "username": "devops",
                            "password": "${ADMIN_PASSWORD}",
                            "role": "Admin",
                            "email": "ricsue@amazon.co.uk",
                            "firstName": "Devops",
                            "lastName": "World"
                        },
                        ],
                        "usersTemplates" : {
                                "ADMIN_PASSWORD" : 
                                {
                                    "kind" : "secret",
                                    "name" : "airflow-users-secret",
                                    "key" : "adminpassword"
                                },
                        },
                        "usersUpdate" : True,
                        "connections": [],
                        "variables": [],
                        "pools": [],
                        "extraPipPackages": [],
                        "extraEnv": [
                            {
                                "name" : "AIRFLOW__CORE__FERNET_KEY",
                                "valueFrom" : { "secretKeyRef" : {"name" : "airflow-core-secret", "key" : "fernet"} }
                            },
                            {
                                "name" : "AIRFLOW__WEBSERVER__SECRET_KEY",
                                "valueFrom" : { "secretKeyRef" : {"name" : "airflow-core-secret", "key" : "webkey"} }
                            },
                            ],
                        "extraVolumeMounts": [],
                        "extraVolumes": []
                    },
                    "scheduler": {
                        "replicas": 1,
                        "resources": {},
                        "logCleanup": {
                        "enabled": False,
                        "retentionMinutes": 21600
                        },
                        "livenessProbe": {
                        "enabled": True,
                        "taskCreationCheck": {
                            "enabled": False,
                            "thresholdSeconds": 300,
                            "schedulerAgeBeforeCheck": 180
                        }
                        }
                    },
                    "web": {
                        "replicas": 1,
                        "resources": {},
                        "service": {
                        "type": "ClusterIP",
                        "externalPort": 8080
                        },
                        "webserverConfig": {
                        "stringOverride": "from airflow import configuration as conf\nfrom flask_appbuilder.security.manager import AUTH_DB\n\n# the SQLAlchemy connection string\nSQLALCHEMY_DATABASE_URI = conf.get(\"core\", \"SQL_ALCHEMY_CONN\")\n\n# use embedded DB for auth\nAUTH_TYPE = AUTH_DB\n",
                        "existingSecret": ""
                        }
                    },
                    "workers": {
                        "enabled": True,
                        "replicas": 1,
                        "resources": {},
                        "logCleanup": {
                        "enabled": False,
                        "retentionMinutes": 21600
                        }
                    },
                    "triggerer": {
                        "enabled": False,
                        "replicas": 1,
                        "resources": {},
                        "capacity": 1000
                    },
                    "flower": {
                        "enabled": True,
                        "replicas": 1,
                        "resources": {},
                        "service": {
                        "type": "ClusterIP",
                        "externalPort": 5555
                        }
                    },
                    "logs": {
                        "path": "/opt/airflow/efs/logs",
                        "persistence": {
                        "enabled": True,
                        "subPath" : "",
                        "storageClass" : "efs",
                        "accessMode" : "ReadWriteMany",
                        "size": "1Gi"
                        }
                    },
                    "dags": {
                        "path": "/opt/airflow/dags",
                        "persistence": {
                        "enabled": False
                        },
                        "gitSync": {
                        "enabled": True,
                        "repo": "https://git-codecommit.eu-west-3.amazonaws.com/v1/repos/airflow-dags-cicd-demo",
                        "branch": "main",
                        "revision": "HEAD",
                        "repoSubPath": "dags",
                        "syncWait": 60,
                        "httpSecret": "airflow-http-codecommit-secret",
                        "httpSecretUsernameKey": "username",
                        "httpSecretPasswordKey": "password"
                        }
                    },
                    "ingress": {
                        "enabled": True
                    },
                    "serviceAccount": {
                        "create": True,
                        "name": "",
                        "annotations": {}
                    },
                    "extraManifests": [],
                    "pgbouncer": {
                        "enabled": True,
                        "resources": {},
                        "authType": "md5"
                    },
                    "postgresql": {
                        "enabled": True,
                        "persistence": {
                        "enabled": True,
                        "storageClass": "",
                        "size": "8Gi"
                        }
                    },
                    "externalDatabase": {
                        "type": "postgres"
                    },
                    "redis": {
                        "enabled": True,
                        "cluster": {
                        "enabled": False,
                        "slaveCount": 1
                        },
                        "master": {
                        "resources": {},
                        "persistence": {
                            "enabled": False,
                            "storageClass": "",
                            "size": "8Gi"
                        }
                        },
                        "slave": {
                        "resources": {},
                        "persistence": {
                            "enabled": False,
                            "storageClass": "",
                            "size": "8Gi"
                        }
                        }
                    },
                    "externalRedis": {
                        "host": "localhost"
                    }
                }

        )

        namespace="eks-airflow-cluster"
        airflow_forward_cmd = f'kubectl port-forward --namespace {namespace} $(kubectl get pods --namespace {namespace} -l "component=web,app=airflow" -o jsonpath="{{.items[0].metadata.name}}") 8080:8080'
        CfnOutput(self, "AirflowLoginCommand", value=airflow_forward_cmd)

        # Add Ingress manifest which creates AWS ALB, assigns certificate created in the utils stack
        # and then enables SSL redirect to Airflow. Service name is the pod with "-web"

        cluster.add_manifest(
            "eks-airflow-cluster",
            {
                "apiVersion": "networking.k8s.io/v1",
                "kind": "Ingress",
                "metadata": {
                    "namespace" : "eks-airflow-cluster",
                    "name" : "eks-airflow-cluster",
                    "annotations" : {
                        "alb.ingress.kubernetes.io/scheme" : "internet-facing",
                        "alb.ingress.kubernetes.io/target-type" : "ip",
                        "alb.ingress.kubernetes.io/certificate-arn" : certarn ,
                        "alb.ingress.kubernetes.io/listen-ports" : '[{"HTTP": 80} , {"HTTPS": 443}]',
                        "external-dns.alpha.kubernetes.io/hostname" : "airflow-eks.beachkube.co.uk",
                        "alb.ingress.kubernetes.io/actions.ssl-redirect" : '{ "Type" : "redirect", "RedirectConfig": { "Protocol": "HTTPS", "Port": "443", "StatusCode": "HTTP_301"}',
                        "alb.ingress.kubernetes.io/ssl-redirect" : '443'
                    } 
                },
                "spec": {
                    "ingressClassName" : "alb",
                    "rules" : [
                        {
                            "http" : {
                                "paths" : [
                                    {
                                        "path" : "/",
                                        "pathType" : "Prefix",
                                        "backend" : 
                                        {
                                        "service" : {
                                            "name" :"eks-airflow-cluster-web",
                                            "port" : {"number": 8080}
                                            }                                 
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            }
        )

        # Add CNAME record to point friendly domain name to ALB

        cnamerecord = cluster.get_ingress_load_balancer_address("eks-airflow-cluster", namespace="eks-airflow-cluster")
        get_hosted_zone = route53.HostedZone.from_lookup(
            self,
            "ricsue.dev",
            domain_name="beachkube.co.uk"
            )
        add_cname = route53.CnameRecord(
            self,
            "CNAME",
            zone=get_hosted_zone,
            record_name="airflow-eks",
            domain_name=cnamerecord
            )

        CfnOutput(
                self, "EKSClusterName",
                value=cluster.cluster_name,
                description="The name of the EKS Cluster",
                export_name="EKSClusterName"
            )
        # Output the EKS Cluster OIDC Issuer and Export it
        CfnOutput(
                self, "EKSClusterOIDCProviderARN",
                value=cluster.open_id_connect_provider.open_id_connect_provider_arn,
                description="The EKS Cluster's OIDC Provider ARN",
                export_name="EKSClusterOIDCProviderARN"
            )
        # Output the EKS Cluster kubectl Role ARN
        CfnOutput(
                self, "EKSClusterKubectlRoleARN",
                value=cluster.kubectl_role.role_arn,
                description="The EKS Cluster's kubectl Role ARN",
                export_name="EKSClusterKubectlRoleARN"
            )
        # Output the EKS Cluster SG ID
        CfnOutput(
                self, "EKSSGID",
                value=cluster.kubectl_security_group.security_group_id,
                description="The EKS Cluster's kubectl SG ID",
                export_name="EKSSGID"
            )




