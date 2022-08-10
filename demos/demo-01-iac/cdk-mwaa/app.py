# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#!/usr/bin/env python3

import aws_cdk as cdk 

from mwaa_cdk.mwaa_cdk_backend import MwaaCdkStackBackend
from mwaa_cdk.mwaa_cdk_dev_env import MwaaCdkStackDevEnv
from mwaa_cdk.mwaa_cdk_prd_env import MwaaCdkStackPrdEnv

env_EU=cdk.Environment(region="us-east-2", account="704533066374")
mwaa_props = {'dagss3location': 'airflow-devopswld-demo','mwaa_env' : 'airflow-devopswld-demo'}

app = cdk.App()

mwaa_devopswld_backend = MwaaCdkStackBackend(
    scope=app,
    id="mwaa-devopswld-backend",
    env=env_EU,
    mwaa_props=mwaa_props
)

mwaa_devopswld_env_dev = MwaaCdkStackDevEnv(
    scope=app,
    id="mwaa-devopswld-dev-environment",
    vpc=mwaa_devopswld_backend.vpc,
    env=env_EU,
    mwaa_props=mwaa_props
)

mwaa_devopswld_env_prd = MwaaCdkStackPrdEnv(
    scope=app,
    id="mwaa-devopswld-prd-environment",
    vpc=mwaa_devopswld_backend.vpc,
    env=env_EU,
    mwaa_props=mwaa_props
)

app.synth()
