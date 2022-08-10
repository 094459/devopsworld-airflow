### Demos for CI/CD and Apache Airflow

# requirements
- aws admin access
- dns name server on route53 (ricsue.dev)


**MWAA**

01 - Setting up a local developer environment - using mwaa-local-runner
02 - Local git development and testing with mwaa-local-runner

03 - IaC how to deploy at scale MWAA using CDK - done 
04 - IaC how to deploy at scale MWAA using Terraform - done

05 - Deploy a simple CI/CD pipeline the deploy a DAG with a manual approval - done
06 - Deploy a CI/CD pipeline that performs tests, and then deploys to production

07 - Advanced use cases: updating plugins.zip and requirements.txt
08 - Testing

09 - Orchestrate container ETL logic via ECS Operator (hybrid/cloud)
10 - Orchestrate container ETL logic via EKS Operator

**Self Managed**

01 - Building a CI/CD pipeline to automate the building of your Airflow image - done
02 - Deploying a custom Airflow image to a Kubernetes cluster - done
03 - Deploying a simple CI/CD pipeline - one branch/repo to the other -done
04 - Advanced development workflows using branching and forking 



### Ideas

Create a larger efs volume on the workers - might be useful for doing larger work
Need to figure out how to sync/copy files from efs to s3 and viceversa. especially if using for dags


### Testing Demo

1. Test requirements.txt
2. Test DAG imports
3. Test DAG is valid
4. Style and other tools


### Demo Flow

10 min demo

Show you a local developer setup and what a local iteration would look like
- make a change
- git commit - run tests
- git push - deploy to qa and then to prod

Show you how you can setup a simple CI/CD system with an approval stage


Show you how you can automate the build/deployment of your Airflow environments



