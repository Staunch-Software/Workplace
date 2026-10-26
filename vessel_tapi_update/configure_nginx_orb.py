import os

def main():
    nginx_conf = r"C:\WORKPLACE\nginx\conf\nginx.conf"
    if not os.path.exists(nginx_conf):
        print("      [SKIP] nginx.conf not found at", nginx_conf)
        return
    
    with open(nginx_conf, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
        
    if "location /orb/api/" in content or "location /orb/" in content:
        print("      [OK] Nginx routing for /orb/ is already configured.")
        return
        
    orb_block = """
        # 7. ORB BACKEND (Port 8007).
        # /orb/api/* and /orb/health go to FastAPI (port 8007).
        # All other /orb/* paths are React Router SPA routes -> serve index.html.
        location /orb/api/ {
            proxy_pass http://127.0.0.1:8007/api/;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_http_version 1.1;
            client_max_body_size 20m;
            proxy_read_timeout 300;
        }

        location /orb/health {
            proxy_pass http://127.0.0.1:8007/health;
            proxy_set_header Host $http_host;
        }

        location /orb/ {
            root html;
            index index.html;
            try_files $uri $uri/ /index.html;
        }
"""
    # Insert before the last two closing braces
    # The structure ends with:
    #     }
    # }
    lines = content.splitlines(keepends=True)
    insert_idx = -1
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() == "}":
            insert_idx = i
            break
            
    if insert_idx != -1:
        # Find the second to last closing brace (closing the server block)
        server_close_idx = -1
        for i in range(insert_idx - 1, -1, -1):
            if lines[i].strip() == "}":
                server_close_idx = i
                break
        
        target_idx = server_close_idx if server_close_idx != -1 else insert_idx
        lines.insert(target_idx, orb_block)
        with open(nginx_conf, "w", encoding="utf-8") as f:
            f.writelines(lines)
        print("      [OK] Added ORB routing blocks to nginx.conf.")
    else:
        print("      [WARNING] Could not find closing brace in nginx.conf to insert ORB blocks.")

if __name__ == "__main__":
    main()
