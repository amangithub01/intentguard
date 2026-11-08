'use client';

import { useEffect, useRef } from 'react';

type Face = 'sol' | 'shield' | 'usdc' | 'blocked';

function faceTexture(THREE: typeof import('three'), face: Face) {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const mid = size / 2;

    const base = g.createLinearGradient(0, 0, size, size);
    if (face === 'usdc') {
        base.addColorStop(0, '#5aa7ff');
        base.addColorStop(1, '#1f5fd6');
    } else if (face === 'blocked') {
        base.addColorStop(0, '#ff8aa0');
        base.addColorStop(1, '#c2183c');
    } else {
        base.addColorStop(0, '#b06bff');
        base.addColorStop(0.55, '#5b8cff');
        base.addColorStop(1, '#19f5a0');
    }
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);

    // Raised rim + soft inner shade so the face reads as minted metal.
    g.lineWidth = 26;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.arc(mid, mid, mid - 30, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.arc(mid, mid, mid - 52, 0, Math.PI * 2);
    g.stroke();
    const shade = g.createRadialGradient(mid * 0.7, mid * 0.6, 20, mid, mid, mid);
    shade.addColorStop(0, 'rgba(255,255,255,0.28)');
    shade.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = shade;
    g.fillRect(0, 0, size, size);

    g.save();
    g.translate(mid, mid);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowOffsetY = 6;
    g.shadowBlur = 10;
    if (face === 'sol') {
        // Three slanted bars, like the Solana mark.
        [-80, 0, 80].forEach((y, i) => {
            g.save();
            g.translate(0, y);
            g.transform(1, 0, i === 1 ? 0.9 : -0.9, 1, 0, 0);
            g.fillRect(-115, -19, 230, 38);
            g.restore();
        });
    } else if (face === 'shield') {
        g.lineWidth = 22;
        g.lineJoin = 'round';
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(0, -120);
        g.lineTo(-95, -84);
        g.lineTo(-95, 0);
        g.bezierCurveTo(-95, 70, -50, 112, 0, 125);
        g.bezierCurveTo(50, 112, 95, 70, 95, 0);
        g.lineTo(95, -84);
        g.closePath();
        g.stroke();
        g.beginPath();
        g.moveTo(-40, 2);
        g.lineTo(-8, 34);
        g.lineTo(46, -24);
        g.stroke();
    } else if (face === 'usdc') {
        g.font = '700 190px ui-sans-serif, system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('$', 0, 8);
        g.lineWidth = 16;
        g.beginPath();
        g.arc(0, 0, 150, Math.PI * 0.62, Math.PI * 1.38);
        g.stroke();
        g.beginPath();
        g.arc(0, 0, 150, -Math.PI * 0.38, Math.PI * 0.38);
        g.stroke();
    } else {
        g.lineWidth = 30;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-80, -80);
        g.lineTo(80, 80);
        g.moveTo(80, -80);
        g.lineTo(-80, 80);
        g.stroke();
    }
    g.restore();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
}

/**
 * Metallic coins circling the hero title, rendered with three.js.
 * `replayKey` restarts the fly-in when it changes.
 */
export function CoinOrbit({ className, replayKey = 0 }: { className?: string; replayKey?: number }) {
    const host = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = host.current;
        if (!el) return;
        let disposed = false;
        let cleanup = () => {};

        (async () => {
            const THREE = await import('three');
            const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
            if (disposed) return;

            const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMappingExposure = 0.85;
            el.appendChild(renderer.domElement);
            renderer.domElement.style.width = '100%';
            renderer.domElement.style.height = '100%';

            const scene = new THREE.Scene();
            const pmrem = new THREE.PMREMGenerator(renderer);
            scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

            const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
            camera.position.set(0, 0, 16);

            const key = new THREE.DirectionalLight(0xffffff, 2.2);
            key.position.set(-4, 6, 8);
            scene.add(key);
            const rimGreen = new THREE.PointLight(0x14f195, 26, 30);
            rimGreen.position.set(6, -3, 4);
            scene.add(rimGreen);
            const rimPurple = new THREE.PointLight(0x9945ff, 26, 30);
            rimPurple.position.set(-6, 3, 4);
            scene.add(rimPurple);

            const geo = new THREE.CylinderGeometry(1, 1, 0.18, 72, 1);
            const edge = new THREE.MeshStandardMaterial({ color: 0x9a9ab0, metalness: 1, roughness: 0.28 });
            const faces: Face[] = ['sol', 'shield', 'usdc', 'sol', 'shield', 'blocked', 'sol', 'usdc'];
            const textures = new Map<Face, InstanceType<typeof THREE.CanvasTexture>>();
            const mats: InstanceType<typeof THREE.MeshStandardMaterial>[] = [edge];

            const orbit = new THREE.Group();
            scene.add(orbit);
            const coins = faces.map((f, i) => {
                if (!textures.has(f)) textures.set(f, faceTexture(THREE, f));
                const faceMat = new THREE.MeshStandardMaterial({ map: textures.get(f)!, metalness: 0.55, roughness: 0.38, envMapIntensity: 0.7 });
                mats.push(faceMat);
                const mesh = new THREE.Mesh(geo, [edge, faceMat, faceMat]);
                const s = 0.52 + ((i * 37) % 10) / 45;
                mesh.scale.setScalar(s);
                orbit.add(mesh);
                return { mesh, s, phase: (i / faces.length) * Math.PI * 2, spin: 0.35 + ((i * 53) % 7) / 14, tilt: ((i * 29) % 11) / 11 };
            });

            let rx = 6.2;
            let ry = 3.6;
            let portrait = false;
            let unit = 1;
            const resize = () => {
                const { clientWidth: w, clientHeight: h } = el;
                renderer.setSize(w, h, false);
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
                const halfW = halfH * camera.aspect;
                portrait = camera.aspect < 1;
                rx = portrait ? halfW * 0.92 : Math.min(halfW * 0.86, 8.6);
                ry = portrait ? halfH * 0.82 : Math.min(halfH * 0.8, rx * 0.66);
                unit = portrait ? 0.55 : 1;
            };
            resize();
            const ro = new ResizeObserver(resize);
            ro.observe(el);

            const pointer = { x: 0, y: 0 };
            const onMove = (e: PointerEvent) => {
                pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
                pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
            };
            window.addEventListener('pointermove', onMove);

            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const t0 = performance.now();
            let raf = 0;
            let visible = true;
            const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
            io.observe(el);

            const frame = (now: number) => {
                raf = requestAnimationFrame(frame);
                if (!visible) return;
                const t = (now - t0) / 1000;
                const speed = reduce ? 0 : 0.11;
                coins.forEach((c, i) => {
                    const intro = reduce ? 1 : Math.min(1, Math.max(0, (t - i * 0.08) / 1.4));
                    const ease = 1 - Math.pow(1 - intro, 4);
                    const a = c.phase + t * speed + (1 - ease) * 1.6;
                    const r = 0.25 + 0.75 * ease;
                    c.mesh.position.set(Math.cos(a) * rx * r, Math.sin(a) * ry * r, Math.cos(a + 1.2) * 1.6 - (portrait ? 3 : 1));
                    c.mesh.scale.setScalar(c.s * unit * (0.3 + 0.7 * ease));
                    c.mesh.rotation.x = Math.PI / 2 - 0.35 + Math.sin(t * c.spin + i) * 0.45 + c.tilt * 0.4;
                    c.mesh.rotation.z = Math.sin(t * c.spin * 0.7 + i * 2) * 0.6 + (1 - ease) * 4;
                    c.mesh.rotation.y = reduce ? 0 : t * c.spin * 0.6 + i;
                });
                orbit.rotation.y += (pointer.x * 0.18 - orbit.rotation.y) * 0.04;
                orbit.rotation.x += (pointer.y * 0.12 - orbit.rotation.x) * 0.04;
                renderer.render(scene, camera);
            };
            raf = requestAnimationFrame(frame);

            cleanup = () => {
                cancelAnimationFrame(raf);
                ro.disconnect();
                io.disconnect();
                window.removeEventListener('pointermove', onMove);
                geo.dispose();
                mats.forEach(m => m.dispose());
                textures.forEach(t => t.dispose());
                pmrem.dispose();
                renderer.dispose();
                renderer.domElement.remove();
            };
        })();

        return () => {
            disposed = true;
            cleanup();
        };
    }, [replayKey]);

    return <div ref={host} className={className} aria-hidden />;
}
