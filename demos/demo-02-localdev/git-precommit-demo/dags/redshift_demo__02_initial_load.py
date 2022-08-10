import os
from datetime import timedelta

from airflow import DAG
from airflow.models import Variable
from airflow.models.baseoperator import chain
from airflow.operators.dummy import DummyOperator
from airflow.operators.sql import SQLValueCheckOperator
from airflow.providers.amazon.aws.transfers.s3_to_redshift import S3ToRedshiftOperator
from airflow.providers.postgres.operators.postgres import PostgresOperator
from airflow.utils.dates import days_ago

DAG_ID = os.path.basename(__file__).replace(".py", "")

S3_BUCKET = Variable.get("data_lake_bucket")
SCHEMA = "tickit_demo"
TABLE_COUNTS = {
    "users": 49990,
    "venue": 205,
    "category": 11,
    "date": 365,
    "event": 8798,
    "listing": 17939,
    "sales": 7142,
}
BEGIN_DATE = "2008-01-01"
END_DATE = "2008-01-31"

DEFAULT_ARGS = {
    "owner": "garystafford",
    "depends_on_past": False,
    "retries": 0,
    "email_on_failure": False,
    "email_on_retry": False,
    "redshift_conn_id": "amazon_redshift_dev",
    "postgres_conn_id": "amazon_redshift_dev",
}

with DAG(
    dag_id=DAG_ID,
    description="Initial copy and merge of TICKIT data into Amazon Redshift",
    default_args=DEFAULT_ARGS,
    dagrun_timeout=timedelta(minutes=15),
    start_date=days_ago(1),
    schedule_interval=None,
    tags=["redshift demo"],
) as dag:
    begin = DummyOperator(task_id="begin")

    end = DummyOperator(task_id="end")

    for table in TABLE_COUNTS.keys():
        create_staging_tables = PostgresOperator(
            task_id=f"create_table_{table}_staging",
            sql=f"sql_redshift/create_table_{table}_staging.sql",
        )

        truncate_staging_tables = PostgresOperator(
            task_id=f"truncate_table_{table}_staging",
            sql=f"TRUNCATE TABLE {SCHEMA}.{table}_staging;",
        )

        s3_to_staging_tables = S3ToRedshiftOperator(
            task_id=f"{table}_to_staging",
            s3_bucket=S3_BUCKET,
            s3_key=f"redshift/data/{table}.gz",
            schema=SCHEMA,
            table=f"{table}_staging",
            copy_options=["gzip", "delimiter '|'"],
        )

        merge_staging_data = PostgresOperator(
            task_id=f"merge_{table}",
            sql=f"sql_redshift/merge_{table}.sql",
            params={"begin_date": BEGIN_DATE, "end_date": END_DATE},
        )

        drop_staging_tables = PostgresOperator(
            task_id=f"drop_{table}_staging",
            sql=f"DROP TABLE IF EXISTS {SCHEMA}.{table}_staging;",
        )

        check_row_counts = SQLValueCheckOperator(
            task_id=f"check_row_count_{table}",
            conn_id=DEFAULT_ARGS["redshift_conn_id"],
            sql=f"SELECT COUNT(*) FROM {SCHEMA}.{table}",
            pass_value=TABLE_COUNTS[table],
        )

        chain(
            begin,
            create_staging_tables,
            truncate_staging_tables,
            s3_to_staging_tables,
            merge_staging_data,
            drop_staging_tables,
            check_row_counts,
            end,
        )
