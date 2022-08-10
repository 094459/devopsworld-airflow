import os
from datetime import timedelta

from airflow import DAG
from airflow.models.baseoperator import chain
from airflow.operators.bash import BashOperator
from airflow.operators.dummy import DummyOperator
from airflow.providers.amazon.aws.operators.glue import AwsGlueJobOperator
from airflow.utils.dates import days_ago

DAG_ID = os.path.basename(__file__).replace(".py", "")

TABLES = ["users", "venue", "category", "date", "event", "listing", "sales"]

DEFAULT_ARGS = {
    "owner": "garystafford",
    "depends_on_past": False,
    "retries": 0,
    "email_on_failure": False,
    "email_on_retry": False,
}

with DAG(
    dag_id=DAG_ID,
    description="Run AWS Glue ETL Jobs - source data to raw (bronze) data",
    default_args=DEFAULT_ARGS,
    dagrun_timeout=timedelta(minutes=5),
    start_date=days_ago(1),
    schedule_interval=None,
    tags=["data lake demo", "raw", "bronze"],
) as dag:
    begin = DummyOperator(task_id="begin")

    end = DummyOperator(task_id="end")

    list_glue_tables = BashOperator(
        task_id="list_glue_tables",
        bash_command="""aws glue get-tables --database-name tickit_demo \
                          --query 'TableList[].Name' --expression "raw_*"  \
                          --output table""",
    )

    for table in TABLES:
        start_jobs_raw = AwsGlueJobOperator(
            task_id=f"start_job_{table}_raw", job_name=f"tickit_public_{table}_raw"
        )

        chain(
            begin,
            start_jobs_raw,
            list_glue_tables,
            end,
        )
