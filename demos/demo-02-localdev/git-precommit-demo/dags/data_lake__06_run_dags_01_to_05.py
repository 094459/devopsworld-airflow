import os
from datetime import timedelta

from airflow import DAG
from airflow.models.baseoperator import chain
from airflow.operators.dummy import DummyOperator
from airflow.operators.trigger_dagrun import TriggerDagRunOperator
from airflow.utils.dates import days_ago

from utilities.notifications import (
    slack_success_notification,
    slack_failure_notification,
)

DAG_ID = os.path.basename(__file__).replace(".py", "")

DEFAULT_ARGS = {
    "owner": "garystafford",
    "depends_on_past": False,
    "retries": 0,
    "email_on_failure": False,
    "email_on_retry": False,
}

with DAG(
    dag_id=DAG_ID,
    description="Run all Data Lake Demonstration DAGs",
    default_args=DEFAULT_ARGS,
    dagrun_timeout=timedelta(minutes=30),
    start_date=days_ago(1),
    schedule_interval=None,
    on_failure_callback=slack_failure_notification,
    on_success_callback=slack_success_notification,
    tags=["data lake demo"],
) as dag:
    begin = DummyOperator(task_id="begin")

    end = DummyOperator(task_id="end")

    trigger_dag_01 = TriggerDagRunOperator(
        task_id="trigger_dag_01",
        trigger_dag_id="data_lake__01_clean_and_prep_demo",
        wait_for_completion=True,
    )

    trigger_dag_02 = TriggerDagRunOperator(
        task_id="trigger_dag_02",
        trigger_dag_id="data_lake__02_run_glue_crawlers_source",
        wait_for_completion=True,
    )

    trigger_dag_03 = TriggerDagRunOperator(
        task_id="trigger_dag_03",
        trigger_dag_id="data_lake__03_run_glue_jobs_raw",
        wait_for_completion=True,
    )

    trigger_dag_04 = TriggerDagRunOperator(
        task_id="trigger_dag_04",
        trigger_dag_id="data_lake__04_run_glue_jobs_refined",
        wait_for_completion=True,
    )
    trigger_dag_05 = TriggerDagRunOperator(
        task_id="trigger_dag_05",
        trigger_dag_id="data_lake__05_submit_athena_queries_agg",
        wait_for_completion=True,
    )

chain(
    begin,
    trigger_dag_01,
    trigger_dag_02,
    trigger_dag_03,
    trigger_dag_04,
    trigger_dag_05,
    end,
)
