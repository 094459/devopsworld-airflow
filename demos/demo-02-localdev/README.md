### Demo 1 - local dev environment

Show how you can easily deploy mwaa-local-runner to accelerate local development.

fork repo and then make modifications to some key files
- airflow.cfg to make it quicker to pick up changes
- volume to mount our .aws/credentials file so we can access AWS resources
build image and then show command line tool to run
start and then show us developing a local dag
show how we can use the cli to do python library testing using constraints

### Demo 2 - local development

Show how we can use git pre-commit-hooks to help shift even further left and catch errors before they get pushed to source code. We will run a sub-set of the tests, and show a failing test to see what happens.

show the setup - mwaa running with a simple pipeline
check out dags repo locally
Go to our local dags folder
add git prehooks
make a change
commit that change to our repo
see change being made and tests running
make a change that will break things
try and commit this time and see what it shows


### Demo 3 - simple pipeline

Creating a simple pipeline that will take our DAGs and deploy them into a QA environment for test, and upon review and acceptance, then push them to production

Developer makes a code update and commits
CodePipeline is triggered, deploys to TEST MWAA env
Manual review process initiated
Approval will kick off deployment to Production MWAA env
Reject will stop the deployment


### Demo 4 - advanced dev workflow

Show source code and pipeline running - talk through the level steps and show blog post.


### Additional things to share/show

* MWAA Local Running - set up and testing the DAGS, as well as Python libraries using constraints file

### Notes

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

