# cloudres_infra

# Run backend
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Run frontend
# Installation
sudo npm install -y pm2 -g

# Start an application
pm2 start server.js

# Set up auto-restart on reboot
pm2 startup
pm2 save

# Basic commands
pm2 list           # Show all processes
pm2 stop server    # Stop an application
pm2 restart server # Restart an application
pm2 logs           # Show logs


# Run nginx
sudo nginx
sudo cp /home/ec2-user/cloudres_infra/nginx.conf /etc/nginx/conf.d/cloudres_infra.conf
sudo systemctl reload nginx

# Kill lost nginx (assuming running on port 80)
sudo fuser -k 80/tcp