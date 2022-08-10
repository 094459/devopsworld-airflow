### IaC Installation

This builds 2 x environments used in the other demos using CDK
This builds 1 x environment using Terraform
This builds 1 x environment using CDK and EKS and Helm


### CDK 2 x Dev/Prd environments

- cd cdk-mwaa
- cdk bootstrap aws://ACCOUNT-NUMBER-1/REGION-1
- check app.py
- cdk deploy --all

(approx 50 min)


### Terraform environment

- cd tf-mwaa/terraform-aws-mwaa
- terraform init
- terraform plan
- terraform apply

Answer yes to begin deployment


### CDK EKS/Airflow/Helm

To see EKS resources in the console,

- kubectl edit configmap aws-auth --namespace kube-system
- add user in the mapping, eg
```
apiVersion: v1
data:
  mapAccounts: '[]'
  mapRoles: '[{"rolearn":"arn:aws:iam::704533066374:role/airflow-devopswld-eks-ClusterAdminRole047D4FCA-1RM6PZZ6H88OT","username":"arn:aws:iam::704533066374:role/airflow-devopswld-eks-ClusterAdminRole047D4FCA-1RM6PZZ6H88OT","groups":["system:masters"]},{"rolearn":"arn:aws:iam::704533066374:role/airflow-devopswld-eks-AirflowEKSNodegroupDefaultCa-4ZYTA2YRAE3Z","username":"system:node:{{EC2PrivateDNSName}}","groups":["system:bootstrappers","system:nodes"]},{"rolearn":"arn:aws:iam::704533066374:role/airflow-devopswld-eks-AirflowEKSNodegroupDefaultCa-4ZYTA2YRAE3Z","username":"system:node:{{EC2PrivateDNSName}}","groups":["system:bootstrappers","system:nodes"]}]'
  mapUsers: '[{"userarn":"arn:aws:iam::704533066374:user/airflow-devopswld-eks-opsFCC65C9B-FC98AMU5WF6J","username":"arn:aws:iam::704533066374:user/airflow-devopswld-eks-opsFCC65C9B-FC98AMU5WF6J","groups":["system:masters"]},{"userarn":"arn:aws:iam::704533066374:user/ops","username":"arn:aws:iam::704533066374:user/ops","groups":["system:masters"]}]'
```




