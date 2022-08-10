# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#!/usr/bin/env python3

import aws_cdk as cdk 

from airflow_cdk.airflow_cdk_vpc import AirflowCdkStackVPC
from airflow_cdk.airflow_cdk_utils import AirflowCdkStackUtils
#from airflow_cdk.airflow_cdk_eks import AirflowCdkStackEKS
from airflow_cdk.airflow_cdk_eks2 import AirflowCdkStackEKS2

env_EU=cdk.Environment(region="us-east-2", account="704533066374")
airflow_props = {'s3location': 'airflow-eks-devopswld-demo','airflow_env' : 'airflow-devopswld-demo'}


app = cdk.App()

airflow_eks_devopswld_vpc = AirflowCdkStackVPC(
    scope=app,
    id="airflow-devopswld-vpc",
    env=env_EU,
    airflow_props=airflow_props
)

airflow_eks_devopswld_s3 = AirflowCdkStackUtils(
    scope=app,
    id="airflow-devopswld-s3",
    env=env_EU,
    airflow_props=airflow_props
)

airflow_eks_devopswld_eks = AirflowCdkStackEKS2(
    scope=app,
    id="airflow-devopswld-eks",
    env=env_EU,
    certificate=airflow_eks_devopswld_s3.cert,
    vpc=airflow_eks_devopswld_vpc.vpc,
    airflow_props=airflow_props
)


app.synth()
