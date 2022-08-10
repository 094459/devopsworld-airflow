from aws_cdk import (
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_route53 as route53,
    aws_certificatemanager as acm,
    Tags,
    Stack,
    CfnOutput
)
import boto3

from constructs import Construct

class AirflowCdkStackUtils(Stack):

    def __init__(self, scope: Construct, id: str, airflow_props, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)

        tags = {
            'env': f"{airflow_props['airflow_env']}-dev",
            'service': 'EKS Apache AirFlow'
        }

        # Check to see if certificate exists. If not create it

        get_hosted_zone = route53.HostedZone.from_lookup(
            self,
            "ricsue.dev",
            domain_name="beachkube.co.uk"
            )

        self.cert = acm.Certificate(
            self,
            "ALB-Airflow-EKS-Certificate",
            domain_name="airflow-eks.beachkube.co.uk",
            validation=acm.CertificateValidation.from_dns(get_hosted_zone)
            )
        
        albcertarn = self.cert.certificate_arn

        CfnOutput(
            self,
            id="Cert",
            value=self.cert.certificate_arn,
            description="Certificate Arn: "
        )

        # Check to see if S3 bucket exists. If not create and copy DAGs otherwise leave
        # and just grab S3 arn
        # inspired by https://github.com/dacort/demo-code/blob/main/cdk/big-data-stack/stacks/utils.py

        session = boto3.session.Session()
        s3_resource = session.resource('s3')
        s3_resource.meta.client.head_bucket(Bucket=f"{airflow_props['s3location']}-dev")
        
        if not s3_resource:     
            print("No Bucket found")     
            dags_bucket = s3.Bucket(
                self,
                "mwaa-dags",
                bucket_name=f"{airflow_props['s3location'].lower()}-dev",
                versioned=True,
                block_public_access=s3.BlockPublicAccess.BLOCK_ALL
            )

            for tag in tags:
                Tags.of(dags_bucket).add(tag, tags[tag])

            s3deploy.BucketDeployment(self, "DeployDAG",
            sources=[s3deploy.Source.asset("./dags")],
            destination_bucket=dags_bucket,
            destination_key_prefix="dags",
            prune=False,
            retain_on_delete=False
            )
        if s3_resource:
            print ("Found bucket")
            dags_bucket = s3.Bucket.from_bucket_name(
                self,
                "S3 Bucket",
                f"{airflow_props['s3location'].lower()}-dev"
            )

        dags_bucket_arn = dags_bucket.bucket_arn

        CfnOutput(
            self,
            id="S3Bucket",
            value=dags_bucket_arn,
            description="S3 Bucket Arn used by Apache Airflow EKS"
        )