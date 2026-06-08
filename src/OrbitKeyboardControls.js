import * as THREE from "three";

export class OrbitKeyboardControls {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.target = new THREE.Vector3(0, -1.1, 0);
    this.radius = 4;
    this.theta = -0.4;
    this.phi = 1.24;
    this.dragging = false;
    this.dragMode = "orbit";
    this.previous = { x: 0, y: 0 };
    this.panSpeed = 0.0015;
    this.keys = new Set();
    this.moveSpeed = 4;
    this.fastMoveMultiplier = 2;
    this.moveVelocity = new THREE.Vector3();
    this.moveAcceleration = 7;
    this.moveDamping = 16;
    this.mobileMove = { x: 0, y: 0 };
    this.mobileLook = { x: 0, y: 0 };
    this.mobileLookSpeed = 1.8;
    this.mobileStickStates = [];

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: true });
    canvas.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    this.setupMobileControls();
    this.update();
  }

  onPointerDown(event) {
    this.dragging = true;
    this.dragMode = event.button === 2 || event.shiftKey ? "pan" : "orbit";
    this.previous.x = event.clientX;
    this.previous.y = event.clientY;
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.dragging) return;

    const dx = event.clientX - this.previous.x;
    const dy = event.clientY - this.previous.y;
    this.previous.x = event.clientX;
    this.previous.y = event.clientY;

    if (this.dragMode === "pan") {
      this.pan(dx, dy);
    } else {
      this.theta -= dx * 0.004;
      this.phi = THREE.MathUtils.clamp(this.phi - dy * 0.003, 0.35, Math.PI - 0.2);
    }
    this.update();
  }

  onPointerUp() {
    this.dragging = false;
  }

  onWheel(event) {
    this.radius = THREE.MathUtils.clamp(this.radius + event.deltaY * 0.01, 2.2, 28);
    this.update();
  }

  onContextMenu(event) {
    event.preventDefault();
  }

  onKeyDown(event) {
    if (event.repeat || this.isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (!this.isMovementKey(key)) return;
    event.preventDefault();
    this.keys.add(key);
  }

  onKeyUp(event) {
    const key = event.key.toLowerCase();
    if (!this.isMovementKey(key)) return;
    event.preventDefault();
    this.keys.delete(key);
  }

  isTypingTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
  }

  isMovementKey(key) {
    return key === "w" || key === "a" || key === "s" || key === "d" || key === " " || key === "e" || key === "q" || key === "shift";
  }

  pan(dx, dy) {
    const distanceScale = this.radius * this.panSpeed;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * distanceScale);
    this.target.addScaledVector(up, dy * distanceScale);
  }

  tick(deltaTime) {
    this.applyMobileLook(deltaTime);
    this.applyKeyboardMovement(deltaTime);
    this.update();
  }

  setupMobileControls() {
    const moveElement = document.getElementById("move-stick");
    const lookElement = document.getElementById("look-stick");
    if (!moveElement || !lookElement) return;

    this.mobileStickStates = [this.createMobileStickState(moveElement, "move"), this.createMobileStickState(lookElement, "look")];
  }

  createMobileStickState(element, type) {
    const state = {
      element,
      type,
      activePointerId: null,
      pointerdown: null,
      pointermove: null,
      pointerup: null
    };

    state.pointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.activePointerId = event.pointerId;
      element.setPointerCapture?.(event.pointerId);
      element.classList.add("active");
      this.updateMobileStick(state, event);
    };

    state.pointermove = (event) => {
      if (state.activePointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      this.updateMobileStick(state, event);
    };

    state.pointerup = (event) => {
      if (state.activePointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      element.releasePointerCapture?.(event.pointerId);
      this.resetMobileStick(state);
    };

    element.addEventListener("pointerdown", state.pointerdown);
    window.addEventListener("pointermove", state.pointermove, { passive: false });
    window.addEventListener("pointerup", state.pointerup, { passive: false });
    window.addEventListener("pointercancel", state.pointerup, { passive: false });

    return state;
  }

  updateMobileStick(state, event) {
    const rect = state.element.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const maxTravel = rect.width * 0.28;
    const deadzone = 0.12;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > maxTravel ? maxTravel / distance : 1;
    const knobX = dx * scale;
    const knobY = dy * scale;
    let axisX = knobX / maxTravel;
    let axisY = knobY / maxTravel;

    if (Math.hypot(axisX, axisY) < deadzone) {
      axisX = 0;
      axisY = 0;
    }

    const knob = state.element.querySelector(".mobile-stick-knob");
    if (knob) knob.style.transform = `translate(-50%, -50%) translate(${knobX}px, ${knobY}px)`;

    if (state.type === "move") {
      this.mobileMove.x = axisX;
      this.mobileMove.y = axisY;
    } else {
      this.mobileLook.x = axisX;
      this.mobileLook.y = axisY;
    }
  }

  resetMobileStick(state) {
    state.activePointerId = null;
    state.element.classList.remove("active");

    const knob = state.element.querySelector(".mobile-stick-knob");
    if (knob) knob.style.transform = "translate(-50%, -50%)";

    if (state.type === "move") {
      this.mobileMove.x = 0;
      this.mobileMove.y = 0;
    } else {
      this.mobileLook.x = 0;
      this.mobileLook.y = 0;
    }
  }

  applyMobileLook(deltaTime) {
    if (this.dragging || (this.mobileLook.x === 0 && this.mobileLook.y === 0)) return;
    this.theta -= this.mobileLook.x * this.mobileLookSpeed * deltaTime;
    this.phi = THREE.MathUtils.clamp(this.phi - this.mobileLook.y * this.mobileLookSpeed * 0.75 * deltaTime, 0.35, Math.PI - 0.2);
  }

  applyKeyboardMovement(deltaTime) {
    const move = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3(0, 1, 0);
    this.camera.getWorldDirection(forward);

    if (this.keys.has("w")) move.add(forward);
    if (this.keys.has("s")) move.sub(forward);
    if (this.keys.has("d")) move.add(right);
    if (this.keys.has("a")) move.sub(right);
    if (this.keys.has(" ") || this.keys.has("e")) move.add(up);
    if (this.keys.has("q")) move.sub(up);
    if (this.mobileMove.y !== 0) move.addScaledVector(forward, -this.mobileMove.y);
    if (this.mobileMove.x !== 0) move.addScaledVector(right, this.mobileMove.x);

    const speed = this.moveSpeed * (this.keys.has("shift") ? this.fastMoveMultiplier : 1);
    const desiredVelocity = move.lengthSq() > 0 ? move.normalize().multiplyScalar(speed) : move;
    const damping = move.lengthSq() > 0 ? this.moveAcceleration : this.moveDamping;
    this.moveVelocity.lerp(desiredVelocity, 1 - Math.exp(-damping * deltaTime));

    if (this.moveVelocity.lengthSq() < 0.000001) {
      this.moveVelocity.set(0, 0, 0);
      return;
    }

    this.target.addScaledVector(this.moveVelocity, deltaTime);
  }

  update() {
    const sinPhiRadius = Math.sin(this.phi) * this.radius;
    this.camera.position.set(
      this.target.x + sinPhiRadius * Math.sin(this.theta),
      this.target.y + Math.cos(this.phi) * this.radius,
      this.target.z + sinPhiRadius * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    for (const state of this.mobileStickStates) {
      state.element.removeEventListener("pointerdown", state.pointerdown);
      window.removeEventListener("pointermove", state.pointermove);
      window.removeEventListener("pointerup", state.pointerup);
      window.removeEventListener("pointercancel", state.pointerup);
    }
  }
}
