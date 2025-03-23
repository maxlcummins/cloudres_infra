# cloudres_infra

# Run backend
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Run frontend
node server.js

# Run nginx
sudo nginx -c /home/ec2-user/cloudres_infra/nginx.conf 
