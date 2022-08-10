1. First clone and build local mwaa-local-runner
-fix airflow.cfg to quickly note changes (docker/config/airflow.cfg) dag_dir_list_interval = 5
-fix IAM permissions mount (edit docker/docker-compose-local.yml) and add "- ${HOME}/.aws/credentials:/usr/local/airflow/.aws/credentials:ro"

git clone https://github.com/aws/aws-mwaa-local-runner.git
cd aws-mwaa-local-runner
./mwaa-local-env build-image


2. Deploy a MWAA environment from the cdk-mwaa folder
- update app.py
- cdk deploy mwaa-cicd-backend
- cdk deploy mwaa-cicd-environment

3. Create another MWAA environment using the console in the same VPC
- create a new folder, adding "-prod" to the end
- leave blank

4. Parameter store is used to store AIRFLOW_ENV which is a string that points to the MWWA env name

5. there are a number of codebuild buildspec.yml files
- simple copy to mwaa env s3 bucket
- simple copy to mwaa env (prd) s3 bucket
- advanced flow

Be aware - permissions of CodeBuild: S3Full, SSMFull, CodeBuildFull


### Demo 1 - simple pipeline

Developer makes a code update and commits
CodePipeline is triggered, deploys to TEST MWAA env
Manual review process initiated
Approval will kick off deployment to Production MWAA env
Reject will stop the deployment


### Demo 2 - advanced dev workflow

