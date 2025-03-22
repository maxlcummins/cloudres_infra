# database.py
from sqlalchemy import create_engine, Column, String, TIMESTAMP, JSON
from sqlalchemy.orm import sessionmaker, declarative_base
from datetime import datetime
import os

# DATABASE_URL = os.getenv(
#     "DATABASE_URL",
#     "postgresql://dbuser:monkeypoxwebapp@fastapi-db.c70yw8k6y0t6.ap-southeast-2.rds.amazonaws.com:5432/postgres"
# )

# engine = create_engine(DATABASE_URL)
# SessionLocal = sessionmaker(bind=engine)

Base = declarative_base()

class PipelineRun(Base):
    __tablename__ = "pipeline_runs"
    id = Column(String, primary_key=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    status = Column(String)
    results = Column(JSON, nullable=True)

# Base.metadata.create_all(bind=engine)

def save_pipeline_run(run_id, status, results):
    # with SessionLocal() as db:
    #     run = PipelineRun(id=run_id, status=status, results=results)
    #     db.add(run)
    #     db.commit()
    print("Database saving is disabled")

def get_pipeline_run_status(run_id):
    # with SessionLocal() as db:
    #     run = db.query(PipelineRun).filter_by(id=run_id).first()
    #     if run:
    #         return {"run_id": run.id, "status": run.status, "results": run.results}
    #     else:
    #         return {"status": "Not Found"}
    print("Database retrieval is disabled")
    return {"status": "Database functionality is disabled"}