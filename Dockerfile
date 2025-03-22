FROM python:3.11-slim

WORKDIR /app

# Create a non-root user
RUN adduser -D myuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ./app ./app

# Change ownership of the application directory to the non-root user
RUN chown -R myuser:myuser /app

# Switch to the non-root user
USER myuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]