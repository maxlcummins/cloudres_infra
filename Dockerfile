FROM python:3.11-slim

WORKDIR /app

# Create a non-root user
RUN adduser --no-create-home --disabled-password myuser

# Copy backend requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy frontend source code
COPY frontend ./frontend

# Build the frontend
WORKDIR /app/frontend
RUN npm install
RUN npm run build

# Copy backend source code
WORKDIR /app
COPY backend/app ./app

# Change ownership of the application directory to the non-root user
RUN chown -R myuser:myuser /app

# Switch to the non-root user
USER myuser

# Expose the port
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]