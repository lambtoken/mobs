import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Pathfinding, PathfindingHelper } from 'three-pathfinding';
import StateMachine from './state_machine'

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9def9);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.y = 10;
camera.position.z = 10;
camera.position.x = 33;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const orbitControls = new OrbitControls(camera, renderer.domElement);

orbitControls.mouseButtons = {
    MIDDLE: THREE.MOUSE.ROTATE,
   // RIGHT: THREE.MOUSE.PAN,
};

orbitControls.enableDamping = true;
orbitControls.enablePan = true;
orbitControls.minDistance = 5;
orbitControls.maxDistance = 60;
orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;
orbitControls.minPolarAngle = Math.PI / 4;

const dLight = new THREE.DirectionalLight(0xffffff, 0.9);
dLight.position.set(10, 20, 0);
dLight.castShadow = true;

const shadowCamera = dLight.shadow.camera;
shadowCamera.left = -50;
shadowCamera.right = 50;
shadowCamera.top = 50;
shadowCamera.bottom = -50;
shadowCamera.near = 0.1;
shadowCamera.far = 100;

dLight.shadow.mapSize.width = 1024;
dLight.shadow.mapSize.height = 1024;

scene.add(dLight);

const aLight = new THREE.AmbientLight('white', 1);
scene.add(aLight);

let levelMesh;
const pathfinding = new Pathfinding();
const ZONE = 'level1';
let navmesh;

const rayCaster = new THREE.Raycaster()

const loader = new GLTFLoader();

async function loadLevelMeshes() {
    try {
        const gltfLevel = await loader.loadAsync('./level-mesh.glb');
        gltfLevel.scene.traverse((node) => {
            if (node.isMesh) {
                node.receiveShadow = true;
            }
        });
        levelMesh = gltfLevel.scene;

        const boundingBox = new THREE.Box3().setFromObject(levelMesh)

        scene.add(new THREE.Box3Helper(boundingBox, 0xffff00))
        scene.add(levelMesh);

        const gltfNavMesh = await loader.loadAsync('./level-navmesh.glb');
        gltfNavMesh.scene.traverse((node) => {
            if (!navmesh && node.isMesh) {
                navmesh = node;
                pathfinding.setZoneData(ZONE, Pathfinding.createZone(navmesh.geometry));
            }
        });

        console.log('Level and navmesh loaded.');
    } catch (error) {
        console.error('Error loading level meshes:', error);
    }
}


async function createMobs() {
    await loadLevelMeshes(); 
    if (!navmesh) {
        console.error('Navmesh not found. Cannot create mobs.');
        return;
    }

    for (let i = 0; i < 10; i++) {
        const randomPos = getRandomPositionOnNavMesh();
        if (!randomPos) {
            console.error('Failed to get random position on navmesh.');
            continue;
        }

        const mob = new Mob(randomPos.x, randomPos.y, i % 2)
        mobs.push(mob);
    }

    console.log('Mobs created and ready to go.');
}

const mobs = [];

class Mob {
    constructor(x, z, teamId = 1) {
        this.position = new THREE.Vector3(x, 10, z);
        this.teamId = teamId
        this.alive = true
        this.mesh = null
        this.mixer = null
        this.animationMap = new Map()
        this.currentAnimation = null
        this.currentAction = 'idle';
        this.navpath = null;
        this.pathfinding = pathfinding;
        this.zone = 'zone1';
        this.groupId = 1
        this.stats = {
            maxHp: 100,
            hp: 100,
            damage: 40,
            attackSpeed: 1,
            attackRange: 0.4,
            attackVision: 3
        };
        this.states = new StateMachine(this)
        this.selected = false;
        this.target = null
        this.initialize();
    }

    async initialize() {
        try {
            await this.__loadMesh();
            this.__adjustVertically();
            this.__initStates()
            this.states.changeState('idle')
        } catch (err) {
            console.error('Error initializing mob:', err);
        }
    }

    __initStates() {
        this.states.addState('idle', {
            enter: function(s) {
                if (s.parent.currentAnimation) {
                    s.parent.currentAnimation.fadeOut(0.5)
                }

                const idleAnimation = s.parent.animationMap.get('idle');
                if (idleAnimation && !idleAnimation.isPlaying) {
                    idleAnimation.reset().play();
                }

                s.parent.currentAnimation = idleAnimation
            },
            update: function(dt) {},
            draw: function() {},
            exit: function() {},
        })

        this.states.addState('running', {
            enter: function(s) {
                // currentAnimation fadeout
                if (s.parent.currentAnimation) {
                    s.parent.currentAnimation.fadeOut(0.5)
                }

                const runningAnimation = s.parent.animationMap.get('running');
                if (runningAnimation && !runningAnimation.isPlaying) {
                    runningAnimation.reset().play();
                }

                s.parent.currentAnimation = s.parent.animationMap.get('running')
            },
            update: function(s, dt) {
                if (!s.parent.navpath || s.parent.navpath.length === 0) {
                    s.parent.states.changeState('idle')
                    return;
                }
        
                const targetPosition = s.parent.navpath[0];
        
                const directionVector = targetPosition.clone().sub(s.parent.mesh.position);
                directionVector.y = 0; // Ignore Y-axis for rotation
        
                if (directionVector.lengthSq() > 0.01) {
                    const targetAngle = Math.atan2(directionVector.x, directionVector.z);
        
                    const currentAngle = s.parent.mesh.rotation.y;
                    const rotationSpeed = 5;
                    const interpolatedAngle = THREE.MathUtils.lerp(currentAngle, targetAngle, rotationSpeed * dt);
        
                    s.parent.mesh.rotation.y = interpolatedAngle;
        
                    const normalizedDirection = directionVector.normalize();
                    s.parent.mesh.position.add(normalizedDirection.multiplyScalar(dt * 5));
                } else {
                    s.parent.navpath.shift();
                }
            },
            draw: function() {},
            exit: function(s) {}
        });
        

        this.states.addState('chasing', {
            enter: function() {},
            update: function(dt) {},
            draw: function() {},
            exit: function() {},
        })

        this.states.addState('attacking', {
            enter: function() {},
            update: function(dt) {

            },
            draw: function() {},
            exit: function() {},
        })

        this.states.addState('dying', {
            enter: function(s) {
                s.parent.alive = false
            },
            update: function(dt) {

            },
            draw: function() {},
            exit: function() {},
        })
    }

    __adjustVertically() {
        const rayCaster = new THREE.Raycaster();
        const downVector = new THREE.Vector3(0, -1, 0);
        const rayOrigin = this.position.clone();
        rayCaster.set(rayOrigin, downVector);

        const intersects = rayCaster.intersectObject(levelMesh);
        if (intersects.length > 0) {
            this.position.y = intersects[0].point.y;
            this.mesh.position.y = intersects[0].point.y
        } else {
            console.error("No intersection found!");
        }
    }

    async __loadMesh() {
        try {
            const gltf = await loader.loadAsync('./mob.glb');

            gltf.scene.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    
                    if (node.material) {
                        node.material.dispose()
                        
                        node.material = new THREE.MeshStandardMaterial({
                            color: this.teamId === 0 ? '#0000ff' : '#ff0000',
                            roughness: 0
                        });
                    }
                }
            });
            
            this.mesh = gltf.scene;            

            const targetSize = 0.6
            const boundingBox = new THREE.Box3().setFromObject(this.mesh)
            const size = new THREE.Vector3()
            boundingBox.getSize(size)
            
            const scaleFactor = targetSize / size.x
            
            const {x, y, z} = this.mesh.scale
            
            this.mesh.scale.set(x * scaleFactor, y * scaleFactor, z * scaleFactor)
            
            scene.add(this.mesh);
            this.mesh.position.set(this.position.x, this.position.y, this.position.z);
            
            this.mixer = new THREE.AnimationMixer(this.mesh)

            gltf.animations.forEach(a => {
                console.log(a.name)
                this.animationMap.set(a.name, this.mixer.clipAction(a))
            });
            
            this.animationMap.get('idle').play()

        } catch (error) {
            console.error('Error loading mob mesh:', error);
        }
    }

    findPath(targetPos) {
        const groupID = pathfinding.getGroup(ZONE, this.mesh.position);
        const path = pathfinding.findPath(this.mesh.position, targetPos, ZONE, groupID); 
    
        if (path?.length > 0) {
            this.navpath = path
        }
    }

    addSelectionRing() {
        if (this.selected) {
            return;
        }

        const circle = createSelectionCircle(1.5);
        circle.name = 'selectionCircle';
        this.mesh.add(circle);
    }

    removeSelectionRing() {
        if (!this.selected) {
            return;
        }

        const circle = this.mesh.getObjectByName('selectionCircle');
        if (circle) {
            this.mesh.remove(circle);
        }
    }

    update(dt) {
        if (this.mixer) {
            this.mixer.update(dt)
        }

        this.states.update(dt)

        if (this.stats.hp <= 0 && this.states.currentState != 'dying') {
            this.states.changeState('dying')
        } 
    }
}

function createSelectionCircle(radius = 0.1, segments = 32) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.1, 0, Math.PI * 2, false);

    const geometry = new THREE.BufferGeometry().setFromPoints(shape.getPoints(segments));
    const material = new THREE.LineBasicMaterial({ color: 0xffff00 });

    const circle = new THREE.LineLoop(geometry, material);
    circle.rotation.x = -Math.PI / 2;

    return circle;
}

const selectionBox = document.createElement('div');
selectionBox.style.border = '1px dashed #ffffff';
selectionBox.style.position = 'absolute';
selectionBox.style.pointerEvents = 'none';
document.body.appendChild(selectionBox);

let startPoint = new THREE.Vector2();
let endPoint = new THREE.Vector2();
let isSelecting = false;

renderer.domElement.addEventListener('mousedown', (event) => {

    switch (event.button) {
        case 2:    
            const selected_mobs = mobs.filter(mob => mob.selected)

            let mouse = new THREE.Vector2()

            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            rayCaster.setFromCamera(mouse, camera);

            const intersects = rayCaster.intersectObject(levelMesh, true)
            
            if (intersects.length > 0) {
                const point = intersects[0].point;
                
                const rows = Math.ceil(Math.sqrt(selected_mobs.length))
                const cols = Math.ceil(selected_mobs.length / rows)
                
                const spacing = 0.5;

                for (let i = 0; i < selected_mobs.length; i++) {
                    const mob = selected_mobs[i]
                    const row = Math.floor(i / cols)
                    const col = i % cols;

                    const offsetX = col * spacing - (cols - 1) * spacing / 2
                    const offsetY = row * spacing - (rows - 1) * spacing / 2

                    const targetPosition = new THREE.Vector3(point.x + offsetX, point.y, point.z + offsetY)
                    
                    mob.findPath(targetPosition)
                    mob.states.changeState('running')
                }
            }

            break;
        case 0:
            isSelecting = true;
            startPoint.set(event.clientX, event.clientY);
        
            selectionBox.style.left = startPoint.x + 'px';
            selectionBox.style.top = startPoint.y + 'px';
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
            selectionBox.style.display = 'block';
    }
});

renderer.domElement.addEventListener('mousemove', (event) => {
    if (!isSelecting) return;

    endPoint.set(event.clientX, event.clientY);

    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const width = Math.abs(startPoint.x - endPoint.x);
    const height = Math.abs(startPoint.y - endPoint.y);

    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
});

renderer.domElement.addEventListener('mouseup', () => {
    if (!isSelecting) return;
    isSelecting = false;
    selectionBox.style.display = 'none';

    selectObjectsInRectangle(startPoint, endPoint);
});

function selectObjectsInRectangle(start, end) {
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);

    const selected = [];

    mobs.forEach(mob => {
        const vector = mob.mesh.position.clone().project(camera);

        const screenX = (vector.x + 1) * window.innerWidth / 2;
        const screenY = (-vector.y + 1) * window.innerHeight / 2;

        if (screenX >= left && screenX <= right &&
            screenY >= top && screenY <= bottom) {
            
            selected.push(mob);
            mob.addSelectionRing()
            mob.selected = true
        } else {
            mob.removeSelectionRing()
            mob.selected = false
        }
    });
}


function getRandomPositionOnNavMesh() {
    const groupID = pathfinding.getGroup('level1', new THREE.Vector3(0, 0, 0));
    const range = 1;
    const randomPos = new THREE.Vector3(Math.random() * range, 10, Math.random() * range);
    const randomNode = pathfinding.getRandomNode('level1', groupID, randomPos, 100);

    return randomNode;
}

const clock = new THREE.Clock();

const loop = () => {
    const dt = clock.getDelta();

    mobs.forEach(m => {
        m.update(dt);
    });

    orbitControls.update();
    renderer.render(scene, camera);

    requestAnimationFrame(loop);
};

createMobs();
requestAnimationFrame(loop);