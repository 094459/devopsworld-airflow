### Demos for CI/CD and Apache Airflow

This demo is in two parts.

**Automating the build of Apache Airflow**

The code in the demo-01-iac folder container three demos on how you can automate the building of Apache Airflow. Two of them focus on Amazon Managed Workflows for Apache Airflow (MWAA), providing code for both AWS Cloud Development Kit (AWS CDK) and Hashi Corp's Terraform. The third used AWS CDK to build out how you can run self managed Apache Airflow on Kubernetes, using Helm charts to deploy Apache Airflow into an Amazon EKS Cluster. This demo provides a workflow that shows you how you can update the Apache Airflow image - something you might want to do if you want to have customer libraries, binaries or even non standard versions of Python.

**Local Developer experience**

The code in demo-02-localdev shows you how you can use the mwaa-local-runner to provide a local development environment for data engineers, and then shift left by using open source tools as well as git hooks to run tests on your Apache Airflow workflow files (DAGs) to detect and identify issues early and address issues before they are pushed to your Apache Airflow environments. The code provides some sample DAGs so you can see how this workflow works.

The source folder container various git repos that need to support the CI/CD pipeline that is created for both of these demos.

