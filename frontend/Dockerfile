FROM nginx:alpine

# Конфигурация: статика + reverse-proxy /api на backend.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Статические файлы сайта.
COPY . /usr/share/nginx/html

EXPOSE 80
