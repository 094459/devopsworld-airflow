variable "name" {
  description = "Name of MWAA Environment"
  default     = "airflow-devopswld-demo-tf"
  type        = string
}

variable "region" {
  description = "region"
  type        = string
  default     = "us-east-2"
}

variable "tags" {
  description = "Default tags"
  default     = {"env": "devopswld", "dept": "AWS Developer Relations"}
  type        = map(string)
}

variable "vpc_cidr" {
  description = "VPC CIDR for MWAA"
  type        = string
  default     = "10.1.0.0/16"
}
