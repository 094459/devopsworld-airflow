# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#!/usr/bin/env python3

import aws_cdk as cdk 

from mwaa_cdk.mwaa_cdk_backend import MwaaCdkStackBackend
from mwaa_cdk.mwaa_cdk_env import MwaaCdkStackEnv

env_EU=cdk.Environment(region="eu-west-3", account="704533066374")
mwaa_props = {'dagss3location': 'airflow-cicd-demo-env','mwaa_env' : 'airflow-cicd-demo-env'}

app = cdk.App()

mwaa_cicd_backend = MwaaCdkStackBackend(
    scope=app,
    id="mwaa-cicd-backend",
    env=env_EU,
    mwaa_props=mwaa_props
)

mwaa_cicd_env = MwaaCdkStackEnv(
    scope=app,
    id="mwaa-cicd-environment",
    vpc=mwaa_cicd_backend.vpc,
    env=env_EU,
    mwaa_props=mwaa_props
)

app.synth()
