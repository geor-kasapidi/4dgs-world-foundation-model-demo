import * as THREE from "three";
import { SparkRenderer, SplatMesh, dyno } from "@sparkjsdev/spark";

export class GaussianTransitionWorldManager {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.dyno = dyno;
    this.currentSplat = null;
    this.currentWorldIndex = 0;
    this.nextSplat = null;
    this.meshCache = new Map();
    this.meshLoadPromises = new Map();
    this.isTransitioning = false;
    this.transitionDuration = 1500;
    this.transitionT = dyno.dynoFloat(0);
    this.activeTransitionModifier = null;
    this.depthOfField = {
      enabled: true,
      focalDistance: 3.3,
      apertureSize: 0.045
    };

    this.spark = new SparkRenderer({
      renderer,
      maxPixelRadius: this.isMobileDevice() ? 220 : 512,
      minSortIntervalMs: this.isMobileDevice() ? 70 : 0,
      sortRadial: !this.isMobileDevice(),
      focalDistance: this.depthOfField.focalDistance,
      apertureAngle: 0
    });
    this.updateDepthOfField();
    this.scene.add(this.spark);

    // Relighting can use runtime scene probes, supplied environment maps, or static probe JSON.
    this.worldDefinitions = [
      {
        name: "Bike Shop",
        url: "assets/3dgs/bike-shop.sog",
        position: new THREE.Vector3(-0.5, -3.85, 3.3),
        scale: 2.5,
        generateEnvironmentProbe: true,
        // environmentMap: "assets/env/bike-shop.hdr"
      },
      {
        name: "Theater",
        url: "assets/3dgs/theater.sog",
        position: new THREE.Vector3(0, -0.33, 0),
        generateEnvironmentProbe: true
      }
    ];
  }

  isMobileDevice() {
    const coarsePointer = window.matchMedia?.("(hover: none), (pointer: coarse)").matches;
    const smallViewport = Math.min(window.innerWidth, window.innerHeight) <= 900;
    return Boolean(/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (coarsePointer && smallViewport));
  }

  updateDepthOfField(settings = {}) {
    Object.assign(this.depthOfField, settings);
    this.spark.focalDistance = this.depthOfField.focalDistance;
    this.spark.apertureAngle =
      this.depthOfField.enabled && this.depthOfField.focalDistance > 0
        ? 2 * Math.atan(0.5 * this.depthOfField.apertureSize / this.depthOfField.focalDistance)
        : 0;
  }

  async initialize(onProgress = null) {
    onProgress?.(`Loading ${this.worldDefinitions[0].name}...`);
    await this.loadSimpleWorld(0);
    onProgress?.(`${this.worldDefinitions[0].name} ready. Use left and right arrows to transition.`);
    this.preloadOtherWorlds(onProgress);
  }

  async loadSimpleWorld(worldIndex) {
    const worldDef = this.worldDefinitions[worldIndex];
    const mesh = await this.createWorldMesh(worldDef);
    this.spark.add(mesh);
    this.currentSplat = mesh;
    this.currentWorldIndex = worldIndex;
    this.meshCache.set(worldDef.url, mesh);
    this.enterIdleState(mesh);
    return mesh;
  }

  preloadOtherWorlds(onProgress = null) {
    this.worldDefinitions.forEach((worldDef, index) => {
      if (index === this.currentWorldIndex) return;
      this.getWorldMesh(worldDef)
        .then((mesh) => {
          if (mesh !== this.currentSplat && mesh.parent !== this.spark) mesh.visible = false;
          onProgress?.(`Preloaded ${worldDef.name}.`);
        })
        .catch((error) => {
          console.warn(`Failed to preload ${worldDef.name}:`, error);
        });
    });
  }

  async go(offset) {
    const count = this.worldDefinitions.length;
    const nextIndex = (this.currentWorldIndex + offset + count) % count;
    return this.loadWorld(nextIndex);
  }

  async loadWorld(worldIndex) {
    if (worldIndex === this.currentWorldIndex || this.isTransitioning) return false;
    const worldDef = this.worldDefinitions[worldIndex];

    try {
      this.isTransitioning = true;
      const targetMesh = await this.getWorldMesh(worldDef);
      await this.ensureTransitionReady(this.currentSplat, targetMesh);

      this.nextSplat = targetMesh;
      this.nextSplat.visible = false;
      if (this.nextSplat.parent !== this.spark) this.spark.add(this.nextSplat);

      await this.performGaussianTransition(this.currentSplat, this.nextSplat);

      const previousSplat = this.currentSplat;
      const previousWorldDef = this.worldDefinitions[this.currentWorldIndex];
      this.removeTransitionModifier(previousSplat);
      this.spark.remove(previousSplat);
      this.applyWorldTransform(previousSplat, previousWorldDef);

      this.currentSplat = this.nextSplat;
      this.nextSplat = null;
      this.currentWorldIndex = worldIndex;
      this.enterIdleState(this.currentSplat);
      return true;
    } catch (error) {
      console.error(`Failed to transition to ${worldDef.name}:`, error);
      if (this.nextSplat && this.nextSplat !== this.currentSplat && this.nextSplat.parent === this.spark) {
        this.spark.remove(this.nextSplat);
      }
      if (this.currentSplat) {
        this.applyWorldTransform(this.currentSplat, this.worldDefinitions[this.currentWorldIndex]);
        this.enterIdleState(this.currentSplat);
      }
      this.nextSplat = null;
      return false;
    } finally {
      this.isTransitioning = false;
    }
  }

  async createWorldMesh(worldDef) {
    const mesh = new SplatMesh({
      url: worldDef.url,
      maxSh: 0
    });

    this.applyWorldTransform(mesh, worldDef);
    mesh.visible = true;
    await this.waitForMeshInitialized(mesh, worldDef);
    return mesh;
  }

  async getWorldMesh(worldDef) {
    let mesh = this.meshCache.get(worldDef.url);
    if (mesh) {
      await mesh.initialized;
      return mesh;
    }

    if (!this.meshLoadPromises.has(worldDef.url)) {
      const loadPromise = this.createWorldMesh(worldDef)
        .then((loadedMesh) => {
          this.meshCache.set(worldDef.url, loadedMesh);
          this.meshLoadPromises.delete(worldDef.url);
          return loadedMesh;
        })
        .catch((error) => {
          this.meshLoadPromises.delete(worldDef.url);
          throw error;
        });
      this.meshLoadPromises.set(worldDef.url, loadPromise);
    }

    mesh = await this.meshLoadPromises.get(worldDef.url);
    this.meshCache.set(worldDef.url, mesh);
    return mesh;
  }

  async waitForMeshInitialized(mesh, worldDef, timeoutMs = this.isMobileDevice() ? 45000 : 30000) {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(`${worldDef.name} did not finish initializing within ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });

    try {
      await Promise.race([mesh.initialized, timeout]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  applyWorldTransform(mesh, worldDef) {
    if (!mesh) return;
    mesh.rotation.set(Math.PI, 0, 0);
    mesh.position.copy(worldDef?.position || new THREE.Vector3());
    mesh.scale.setScalar(worldDef?.scale ?? 5);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    mesh.updateVersion?.();
  }

  async ensureTransitionReady(sourceMesh, targetMesh) {
    if (!sourceMesh || !targetMesh) throw new Error("Gaussian transition requires source and target splats");
    await Promise.all([sourceMesh.initialized, targetMesh.initialized]);

    const sourceSplats = sourceMesh.packedSplats;
    const targetSplats = targetMesh.packedSplats;
    if (!sourceSplats?.dyno || !targetSplats?.dyno) {
      throw new Error("Gaussian transition requires initialized PackedSplats with dyno uniforms");
    }

    if (sourceSplats.numSplats !== targetSplats.numSplats) {
      console.warn(
        `Gaussian count mismatch: source=${sourceSplats.numSplats}, target=${targetSplats.numSplats}. ` +
          "SparkJS will read target splats by source index; matching asset preprocessing is recommended."
      );
    }
  }

  enterIdleState(mesh) {
    this.activeTransitionModifier = null;
    mesh.visible = true;
    mesh.objectModifiers = undefined;
    mesh.updateGenerator?.();
    mesh.updateVersion?.();
  }

  removeTransitionModifier(mesh) {
    if (!mesh || !this.activeTransitionModifier) return;
    const nextModifiers = (mesh.objectModifiers || []).filter((modifier) => modifier !== this.activeTransitionModifier);
    mesh.objectModifiers = nextModifiers.length > 0 ? nextModifiers : undefined;
    this.activeTransitionModifier = null;
    mesh.updateGenerator?.();
    mesh.updateVersion?.();
  }

  async performGaussianTransition(sourceMesh, targetMesh) {
    return new Promise((resolve) => {
      this.transitionT.value = 0;
      const targetSplats = targetMesh.packedSplats;
      const sourceStartPosition = sourceMesh.position.clone();
      const sourceStartQuaternion = sourceMesh.quaternion.clone();
      const sourceStartScale = sourceMesh.scale.clone();
      const targetPosition = targetMesh.position.clone();
      const targetQuaternion = targetMesh.quaternion.clone();
      const targetScale = targetMesh.scale.clone();

      const transitionDyno = new this.dyno.Dyno({
        inTypes: {
          gsplat1: this.dyno.Gsplat,
          gsplat2: this.dyno.Gsplat,
          t: "float"
        },
        outTypes: { gsplat: this.dyno.Gsplat },
        statements: ({ inputs, outputs }) => this.dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat1};
          ${outputs.gsplat}.center = mix(${inputs.gsplat1}.center, ${inputs.gsplat2}.center, ${inputs.t});
          ${outputs.gsplat}.scales = mix(${inputs.gsplat1}.scales, ${inputs.gsplat2}.scales, ${inputs.t});
          ${outputs.gsplat}.quaternion = slerp(${inputs.gsplat1}.quaternion, ${inputs.gsplat2}.quaternion, ${inputs.t});
          ${outputs.gsplat}.rgba = mix(${inputs.gsplat1}.rgba, ${inputs.gsplat2}.rgba, ${inputs.t});
        `)
      });

      const gaussianModifier = this.dyno.dynoBlock(
        { gsplat: this.dyno.Gsplat },
        { gsplat: this.dyno.Gsplat },
        ({ gsplat }) => {
          const { index } = this.dyno.splitGsplat(gsplat).outputs;
          const targetCount = this.dyno.numPackedSplats(targetSplats.dyno);
          const targetIndex = this.dyno.imod(index, targetCount);
          const targetGsplat = this.dyno.readPackedSplat(targetSplats.dyno, targetIndex);
          const easedT = this.dyno.smoothstep(
            this.dyno.dynoConst("float", 0),
            this.dyno.dynoConst("float", 1),
            this.transitionT
          );

          return {
            gsplat: transitionDyno.apply({
              gsplat1: gsplat,
              gsplat2: targetGsplat,
              t: easedT
            }).gsplat
          };
        }
      );

      gaussianModifier._worldJamGaussianTransition = true;
      const baseObjectModifiers = (sourceMesh.objectModifiers || []).filter(
        (modifier) => !modifier?._worldJamGaussianTransition
      );
      sourceMesh.objectModifiers = [...baseObjectModifiers, gaussianModifier];
      this.activeTransitionModifier = gaussianModifier;
      sourceMesh.updateGenerator?.();
      sourceMesh.updateVersion?.();

      const startTime = performance.now();
      const animate = (currentTime) => {
        const progress = Math.min((currentTime - startTime) / this.transitionDuration, 1);
        this.transitionT.value = this.easeInOutCubic(progress);
        const transformT = this.transitionT.value;

        sourceMesh.position.lerpVectors(sourceStartPosition, targetPosition, transformT);
        sourceMesh.quaternion.copy(sourceStartQuaternion).slerp(targetQuaternion, transformT);
        sourceMesh.scale.lerpVectors(sourceStartScale, targetScale, transformT);
        sourceMesh.updateMatrix();
        sourceMesh.updateMatrixWorld(true);
        sourceMesh.updateVersion?.();

        if (progress >= 1) resolve();
        else requestAnimationFrame(animate);
      };

      requestAnimationFrame(animate);
    });
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  dispose() {
    if (this.currentSplat) this.spark.remove(this.currentSplat);
    if (this.nextSplat && this.nextSplat !== this.currentSplat) this.spark.remove(this.nextSplat);

    for (const mesh of this.meshCache.values()) mesh.dispose?.();
    this.meshCache.clear();
    this.scene.remove(this.spark);
  }
}
