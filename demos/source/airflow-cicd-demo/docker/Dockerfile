FROM apache/airflow:2.0.2-python3.8

# Need to use USE airflow when installing PyPi libraries
USER airflow

COPY requirements.txt /requirements.txt
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r /requirements.txt

# Switch to USER root for installing other binaries and dependancies
USER root
RUN apt-get update \
 && apt-get install -y wget \
 && apt-get install -y software-properties-common \
 && wget -O- https://apt.corretto.aws/corretto.key | sudo apt-key add - \
 && add-apt-repository 'deb https://apt.corretto.aws stable main' \
 && apt-get update \
 && apt-get install -y java-11-amazon-corretto-jdk \
 && apt-get autoremove -yqq --purge \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

USER airflow

