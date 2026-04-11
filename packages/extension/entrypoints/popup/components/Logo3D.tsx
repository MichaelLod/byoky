import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function Logo3D({ height = 160 }: { height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!containerRef.current || initialized.current) return;
    initialized.current = true;

    const container = containerRef.current;
    const width = container.clientWidth;
    const h = height;

    // Scene
    const scene = new THREE.Scene();
    scene.background = null; // transparent

    // Camera — zoom in more for smaller sizes
    const camera = new THREE.PerspectiveCamera(45, width / h, 0.1, 1000);
    camera.position.set(0, 0, 115);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // Lights — matched to updated 3js scene
    // Soft ambient fill
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    // Warm key light — top right
    const keyLight = new THREE.DirectionalLight(0xffeedd, 2.0);
    keyLight.position.set(50, 40, 90);
    scene.add(keyLight);

    // Cool fill light — left side, softer
    const fillLight = new THREE.DirectionalLight(0xc0d8ff, 0.8);
    fillLight.position.set(-60, -10, 50);
    scene.add(fillLight);

    // Back/rim light — from behind, for edge definition against white bg
    const backLight = new THREE.DirectionalLight(0xffffff, 1.2);
    backLight.position.set(0, 20, -60);
    scene.add(backLight);

    // Subtle top-down light for detail
    const topLight = new THREE.DirectionalLight(0xfff8f0, 0.6);
    topLight.position.set(0, 80, 30);
    scene.add(topLight);

    // Load pixel data
    fetch('/pixels.json')
      .then((r) => r.json())
      .then((data: { width: number; height: number; pixels: [number, number, number][] }) => {
        const { width: pw, height: ph, pixels } = data;

        const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
        const cubeMat = new THREE.MeshStandardMaterial({
          roughness: 0.55,
          metalness: 0.35,
        });

        const count = pixels.length;
        const mesh = new THREE.InstancedMesh(cubeGeo, cubeMat, count);

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        const cx = pw / 2;
        const cy = ph / 2;

        for (let i = 0; i < count; i++) {
          const [x, y, val] = pixels[i];
          const brightness = val / 255;

          dummy.position.set(x - cx, -(y - cy), 0);
          dummy.scale.set(1, 1, 8);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);

          const curved = Math.pow(brightness, 1.6);
          const g = curved * 0.88;
          color.setRGB(g, g * 0.97, g * 0.93);
          mesh.setColorAt(i, color);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        scene.add(mesh);

        // Mouse-follow rotation
        let targetRotY = 0;
        let targetRotX = 0;

        const onMouseMove = (e: MouseEvent) => {
          const vw = document.documentElement.clientWidth || 320;
          const vh = document.documentElement.clientHeight || 500;
          const mouseX = (e.clientX / vw - 0.5) * 2;
          const mouseY = (e.clientY / vh - 0.5) * 2;
          targetRotY = Math.max(-0.4, Math.min(0.4, mouseX * 0.3));
          targetRotX = Math.max(-0.1, Math.min(0.1, -mouseY * 0.08));
        };

        const onMouseLeave = () => {
          targetRotY = 0;
          targetRotX = 0;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseleave', onMouseLeave);

        let angle = 0;
        function animate() {
          requestAnimationFrame(animate);
          angle += 0.003;
          const idleY = Math.sin(angle) * 0.08;
          const idleX = Math.sin(angle * 0.7) * 0.03;
          mesh.rotation.y += (targetRotY + idleY - mesh.rotation.y) * 0.08;
          mesh.rotation.x += (targetRotX + idleX - mesh.rotation.x) * 0.08;
          renderer.render(scene, camera);
        }
        animate();

        const cleanup = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseleave', onMouseLeave);
        };
        (container as any).__logo3dCleanup = cleanup;
      })
      .catch(() => {});

    return () => {
      (container as any).__logo3dCleanup?.();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: `${height}px`,
        flexShrink: 0,
        padding: '12px 0',
      }}
    />
  );
}
