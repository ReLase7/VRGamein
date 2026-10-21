import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// base должен совпадать с именем репозитория, иначе GitHub Pages не найдёт файлы.
export default defineConfig({
  base: '/VRGamein/',
  plugins: [basicSsl()],
  server: {
    host: true, // доступ с Quest по локальной сети: https://<ip-компьютера>:5173/VRGamein/
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
