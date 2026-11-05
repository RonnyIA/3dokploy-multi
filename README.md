# 3Dokploy Multi-Org 🚀

**Visor 3D isométrico de tu infraestructura Dokploy con soporte para múltiples organizaciones, login seguro y métricas internas.**

Tus proyectos de Dokploy se convierten en edificios, tus entornos en zonas, y tus servicios en racks de servidores y tanques de base de datos dentro de un mundo 3D vivo e interactivo.

---

## ✨ Nuevas Características en esta Versión

1. 🏢 **Soporte Multi-Organización:**
   * **Modo Global:** Visualiza tus 4 organizaciones simultáneamente en la misma escena 3D, agrupadas por distritos con colores temáticos distintivos.
   * **Modo Selector:** Alterna con un solo clic entre organizaciones individuales o la vista global desde la barra superior.
2. 🔐 **Asistente de Primer Arranque y Login Seguro:**
   * Al abrir por primera vez la aplicación, un asistente visual te permite crear el usuario administrador y registrar tus 4 organizaciones.
   * Autenticación con contraseñas cifradas (*PBKDF2/SHA-512*) y sesiones seguras en cookies HttpOnly.
3. 🛠️ **Comando CLI para Resetear Contraseñas:**
   * Si alguna vez olvidas la contraseña, recupérala directamente desde la consola con un solo comando:
     ```bash
     docker exec -it 3dokploy-multi reset-password
     ```
4. ⚡ **Métricas Internas y Docker Socket (Estilo Beszel):**
   * Integración con `/var/run/docker.sock` para lectura directa de métricas y contenedores en tiempo real con latencia cero.
   * Conexión directa a través de la red interna `dokploy-network`.

---

## 🚀 Despliegue Rápido con Docker Compose

```yaml
services:
  3dokploy:
    build: .
    image: 3dokploy:multi-org
    container_name: 3dokploy-multi
    restart: unless-stopped
    ports:
      - "3100:3000"
    environment:
      - PORT=3000
      - DATA_DIR=/app/data
      - DOKPLOY_URL=http://host.docker.internal:3000
    volumes:
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    extra_hosts:
      - host.docker.internal:host-gateway
    networks:
      - default
      - dokploy-network

networks:
  dokploy-network:
    name: dokploy-network
    external: true
```

### Ejecutar:
```bash
docker compose up -d --build
```
Abre en tu navegador `http://tu-servidor:3100` y completa el asistente visual de bienvenida.

---

## ⚙️ Comandos de Consola (CLI)

Ejecutables dentro del contenedor Docker:

* **Resetear contraseña de administrador:**
  ```bash
  docker exec -it 3dokploy-multi reset-password [usuario] [nueva-clave]
  ```
* **Listar organizaciones configuradas:**
  ```bash
  docker exec -it 3dokploy-multi node --experimental-strip-types server/cli.ts list-orgs
  ```
* **Ver estado del servicio:**
  ```bash
  docker exec -it 3dokploy-multi node --experimental-strip-types server/cli.ts status
  ```

---

## 💻 Desarrollo Local

Requisitos: Node.js 22.6 o superior.

```bash
npm install
npm run build
npm start
# Abre http://localhost:3000
```
