# Reporte de Stand — Sidhe

Aplicación web para que las **32 sucursales** suban cada martes el estado de su mueble/stand
(fotos + comentarios por sección) y para que administración vea quién ya reportó, explore las
fotos y descargue un **PDF** por sucursal.

---

## 1. Qué incluye

**Para las sucursales** (`/`):
- Eligen su sucursal de un desplegable.
- Llenan sección por sección: Impresora (arriba, lado izq., lado der., interior),
  Cajones, Módem, Pantallas (opcional), Baropodómetro, Barandal lado 1 y 2, Puerta,
  Silla del cliente, Computadora y Desperfectos.
- En cada sección marcan **Funcional / No funcional**, suben **fotos** (varias) y escriben
  **comentarios**. Al final, comentarios y sugerencias generales.
- Al enviar, todo queda registrado y disponible para el panel de administración.

**Para administración** (`/admin.html`, protegido con contraseña):
- Tabla por semana: qué sucursales **ya reportaron** y cuáles están **pendientes**.
- Historial completo de todos los reportes.
- Ver todas las fotos de cada reporte y **descargar el PDF**.

Las fotos se optimizan automáticamente (se reducen de tamaño) para ahorrar espacio.

---

## 2. Personalizar antes de usar

Edita **`config.js`**:

- **`SUCURSALES`**: reemplaza la lista por tus 32 nombres reales de sucursal.
- **`SECCIONES`**: puedes cambiar textos, agregar o quitar secciones.
- **Contraseña admin**: cámbiala con la variable de entorno `ADMIN_PASSWORD`
  (recomendado) o directamente en `config.js`.

---

## 3. Desplegar en EasyPanel

La app trae `Dockerfile`, así que en EasyPanel se despliega como servicio con Docker.

1. **Sube el código** a un repositorio Git (GitHub/GitLab) o compártelo como fuente en EasyPanel.
2. En EasyPanel crea un **App** nuevo:
   - **Source**: tu repositorio (rama `main`).
   - **Build**: tipo **Dockerfile** (lo detecta automáticamente).
3. En **Environment** define las variables:
   ```
   ADMIN_PASSWORD=tu-clave-secreta
   SESSION_SECRET=una-cadena-larga-aleatoria
   PORT=3000
   DATA_DIR=/app/data
   ```
4. En **Volumes / Mounts** monta un volumen persistente en la ruta **`/app/data`**
   (ahí se guardan la base de datos `db.json` y las fotos). Esto es importante: sin volumen,
   los datos se borran en cada redeploy.
5. En **Domains** asigna el dominio y deja que EasyPanel exponga el **puerto 3000**.
6. Deploy. Listo:
   - Formulario para sucursales: `https://tu-dominio/`
   - Panel de administración: `https://tu-dominio/admin.html`

> Comparte con las sucursales solo el enlace del formulario (`/`).
> El panel `/admin.html` pide contraseña.

---

## 4. Correr localmente (para pruebas)

```bash
npm install
ADMIN_PASSWORD=test123 npm start
```

Luego abre `http://localhost:3000`.

---

## 5. Notas técnicas

- **Sin base de datos externa**: usa un archivo `db.json` dentro de `DATA_DIR`.
  Suficiente para reportes semanales de 32 sucursales. Respáldalo copiando la carpeta `data`.
- **Semana**: los reportes se agrupan por semana ISO (lunes a domingo), por lo que el reporte
  del martes cae en la semana correcta automáticamente.
- **Fotos**: se guardan en `DATA_DIR/uploads` como JPEG optimizado.
- **Respaldos**: para respaldar todo, copia la carpeta montada en `/app/data`.
