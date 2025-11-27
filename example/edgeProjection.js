import {
	Box3,
	WebGLRenderer,
	Scene,
	DirectionalLight,
	AmbientLight,
	Group,
	MeshStandardMaterial,
	MeshBasicMaterial,
	BufferGeometry,
	BufferAttribute,
	LineSegments,
	LineBasicMaterial,
	OrthographicCamera,
} from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ProjectionGenerator } from '..';
import { ProjectionGeneratorWorker } from '../src/worker/ProjectionGeneratorWorker.js';
import { generateEdges } from '../src/utils/generateEdges.js';

const params = {
	displayModel: 'color',
	displayEdges: false,
	displayProjection: true,
	sortEdges: true,
	includeIntersectionEdges: true,
	angleThreshold: 50,
	useWorker: false,
	rotate: () => {

		group.quaternion.random();
		group.position.set( 0, 0, 0 );
		group.updateMatrixWorld( true );

		const box = new Box3();
		box.setFromObject( model, true );
		box.getCenter( group.position ).multiplyScalar( - 1 );
		group.position.y = Math.max( 0, - box.min.y ) + 1;

	},
	regenerate: () => {

		task = updateEdges();

	},
};

let renderer, camera, scene, gui, controls;
let lines, model, projection, group, shadedWhiteModel, whiteModel;
let outputContainer;
let worker;
let task = null;
let gltfLoader;

init();

async function init() {

	outputContainer = document.getElementById( 'output' );

	const bgColor = 0xeeeeee;

	// renderer setup
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	document.body.appendChild( renderer.domElement );

	// scene setup
	scene = new Scene();

	// lights
	const light = new DirectionalLight( 0xffffff, 3.5 );
	light.position.set( 1, 2, 3 );
	scene.add( light );

	const ambientLight = new AmbientLight( 0xb0bec5, 0.5 );
	scene.add( ambientLight );

	// setup GLTF loader
	gltfLoader = new GLTFLoader().setMeshoptDecoder( MeshoptDecoder );

	// camera setup (initialized before loadModel so it can be adjusted)
	const aspect = window.innerWidth / window.innerHeight
	const size = 5
	camera = new OrthographicCamera( - size * aspect, size * aspect, size, - size, 0.01, 50 )
	camera.position.set( 0, 5, 0 )
	camera.lookAt( 0, 0, 0 )
	camera.updateProjectionMatrix()

	// load initial model
	group = new Group();
	scene.add( group );

	await loadModel( 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/main/models/nasa-m2020/Perseverance.glb' );

	// create projection display mesh
	projection = new LineSegments( new BufferGeometry(), new LineBasicMaterial( { color: 0x030303 } ) );
	scene.add( projection );

	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	gui = new GUI();
	gui.add( params, 'displayModel', [
		'none',
		'color',
		'shaded white',
		// 'white',
	] );
	// gui.add( params, 'displayEdges' );
	gui.add( params, 'displayProjection' );
	gui.add( params, 'sortEdges' );
	gui.add( params, 'angleThreshold', 0, 180 ).onChange( () => {

		updateModelEdges();
		task = updateEdges();

	} );
	gui.add( params, 'includeIntersectionEdges' );
	gui.add( params, 'useWorker' );
	gui.add( params, 'rotate' );
	gui.add( params, 'regenerate' );

	worker = new ProjectionGeneratorWorker();

	render();

	window.addEventListener( 'resize', function () {

		const aspect = window.innerWidth / window.innerHeight
		const size = 5
		camera.left = - size * aspect
		camera.right = size * aspect
		camera.top = size
		camera.bottom = - size
		camera.updateProjectionMatrix()

		renderer.setSize( window.innerWidth, window.innerHeight )

	}, false )

	// setup drag and drop
	setupDragAndDrop();

}

async function loadModel( source ) {

	outputContainer.innerText = 'loading model...';

	// cleanup old model if it exists
	if ( model ) {

		// dispose geometries
		model.traverse( c => {

			if ( c.geometry ) {

				c.geometry.dispose();

			}
			if ( c.material ) {

				if ( Array.isArray( c.material ) ) {

					c.material.forEach( m => m.dispose() );

				} else {

					c.material.dispose();

				}

			}

		} );

		// dispose cloned models
		if ( shadedWhiteModel ) {

			shadedWhiteModel.traverse( c => {

				if ( c.geometry ) c.geometry.dispose();
				if ( c.material ) {

					if ( Array.isArray( c.material ) ) {

						c.material.forEach( m => m.dispose() );

					} else {

						c.material.dispose();

					}

				}

			} );

		}
		if ( whiteModel ) {

			whiteModel.traverse( c => {

				if ( c.geometry ) c.geometry.dispose();
				if ( c.material ) {

					if ( Array.isArray( c.material ) ) {

						c.material.forEach( m => m.dispose() );

					} else {

						c.material.dispose();

					}

				}

			} );

		}

		// remove from scene
		group.remove( model, shadedWhiteModel, whiteModel, lines );
		lines.traverse( c => {

			if ( c.geometry ) c.geometry.dispose();
			if ( c.material ) c.material.dispose();

		} );

	}

	// load new model
	let gltf;
	if ( typeof source === 'string' ) {

		gltf = await gltfLoader.loadAsync( source );

	} else {

		// source is a File/Blob
		const url = URL.createObjectURL( source );
		gltf = await gltfLoader.loadAsync( url );
		URL.revokeObjectURL( url );

	}

	model = gltf.scene;

	const whiteMaterial = new MeshStandardMaterial( {
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	} );
	shadedWhiteModel = model.clone();
	shadedWhiteModel.traverse( c => {

		if ( c.material ) {

			c.material = whiteMaterial;

		}

	} );

	const whiteBasicMaterial = new MeshBasicMaterial( {
		polygonOffset: true,
		polygonOffsetFactor: 1,
		polygonOffsetUnits: 1,
	} );
	whiteModel = model.clone();
	whiteModel.traverse( c => {

		if ( c.material ) {

			c.material = whiteBasicMaterial;

		}

	} );

	group.updateMatrixWorld( true );

	// center model
	const box = new Box3();
	box.setFromObject( model, true );
	box.getCenter( group.position ).multiplyScalar( - 1 );
	group.position.y = Math.max( 0, - box.min.y ) + 1;
	group.add( model, shadedWhiteModel, whiteModel );

	// adjust camera to frame the model
	const size = Math.max( box.max.x - box.min.x, box.max.z - box.min.z ) * 0.6
	const aspect = window.innerWidth / window.innerHeight
	camera.left = - size * aspect
	camera.right = size * aspect
	camera.top = size
	camera.bottom = - size
	camera.updateProjectionMatrix()

	// generate geometry line segments
	updateModelEdges();

	// restart projection process
	task = updateEdges();

}

function setupDragAndDrop() {

	const dropZone = document.getElementById( 'dropZone' );
	const body = document.body;
	let dragCounter = 0;

	// prevent default drag behaviors
	[ 'dragenter', 'dragover', 'dragleave', 'drop' ].forEach( eventName => {

		body.addEventListener( eventName, preventDefaults, false );

	} );

	function preventDefaults( e ) {

		e.preventDefault();
		e.stopPropagation();

	}

	// highlight drop zone when item is dragged over it
	body.addEventListener( 'dragenter', () => {

		dragCounter ++;
		dropZone.classList.add( 'active' );

	}, false );

	body.addEventListener( 'dragover', () => {

		dropZone.classList.add( 'active' );

	}, false );

	body.addEventListener( 'dragleave', () => {

		dragCounter --;
		if ( dragCounter === 0 ) {

			dropZone.classList.remove( 'active' );

		}

	}, false );

	body.addEventListener( 'drop', ( e ) => {

		dragCounter = 0;
		dropZone.classList.remove( 'active' );
		handleDrop( e );

	}, false );

	function handleDrop( e ) {

		const dt = e.dataTransfer;
		const files = dt.files;

		if ( files.length > 0 ) {

			const file = files[ 0 ];
			if ( file.name.toLowerCase().endsWith( '.glb' ) || file.name.toLowerCase().endsWith( '.gltf' ) ) {

				loadModel( file );

			} else {

				outputContainer.innerText = 'Please drop a GLB or GLTF file';

			}

		}

	}

}

function* updateEdges( runTime = 30 ) {

	outputContainer.innerText = 'processing: --';

	// transform and merge geometries to project into a single model
	let timeStart = window.performance.now();
	const geometries = [];
	model.updateWorldMatrix( true, true );
	model.traverse( c => {

		if ( c.geometry ) {

			const clone = c.geometry.clone();

			// deep copy the position attribute to avoid modifying shared geometry
			const posAttr = clone.getAttribute( 'position' );
			if ( posAttr ) {

				const array = new Float32Array( posAttr.count * 3 );
				for ( let i = 0; i < posAttr.count; i ++ ) {

					array[ i * 3 + 0 ] = posAttr.getX( i );
					array[ i * 3 + 1 ] = posAttr.getY( i );
					array[ i * 3 + 2 ] = posAttr.getZ( i );

				}
				clone.setAttribute( 'position', new BufferAttribute( array, 3 ) );

			}

			clone.applyMatrix4( c.matrixWorld );
			for ( const key in clone.attributes ) {

				if ( key !== 'position' ) {

					clone.deleteAttribute( key );

				}

			}

			geometries.push( clone );

		}

	} );
	const mergedGeometry = mergeGeometries( geometries, false );
    mergedGeometry.computeBoundingBox();
    const { min, max } = mergedGeometry.boundingBox;
    console.log('Merged geometry bounds:', {
        min: { x: min.x, y: min.y, z: min.z },
        max: { x: max.x, y: max.y, z: max.z },
        size: {
            x: max.x - min.x,
            y: max.y - min.y,
            z: max.z - min.z,
        }
    });

    // Check generator settings
    console.log('Generator Settings:', {
        sortEdges: params.sortEdges,
        includeIntersectionEdges: params.includeIntersectionEdges,
        angleThreshold: params.angleThreshold
    });
	const mergeTime = window.performance.now() - timeStart;

	yield;

	if ( params.includeIntersectionEdges ) {

		outputContainer.innerText = 'processing: finding edge intersections...';
		projection.geometry.dispose();
		projection.geometry = new BufferGeometry();

	}

	// generate the candidate edges
	timeStart = window.performance.now();

	let geometry = null;
	if ( ! params.useWorker ) {

		const generator = new ProjectionGenerator();
		generator.sortEdges = params.sortEdges;
		generator.iterationTime = runTime;
		generator.angleThreshold = params.angleThreshold;
		generator.includeIntersectionEdges = params.includeIntersectionEdges;

		const task = generator.generate( mergedGeometry, {

			onProgress: ( p, data ) => {

				outputContainer.innerText = `processing: ${ parseFloat( ( p * 100 ).toFixed( 2 ) ) }%`;
				if ( params.displayProjection ) {

					projection.geometry.dispose();
					projection.geometry = data.getLineGeometry();

				}


			},

		} );

		let result = task.next();
		while ( ! result.done ) {

			result = task.next();
			yield;

		}

		geometry = result.value;

	} else {

		worker
			.generate( mergedGeometry, {
				sortEdges: params.sortEdges,
				includeIntersectionEdges: params.includeIntersectionEdges,
				angleThreshold: params.angleThreshold,
				onProgress: p => {

					outputContainer.innerText = `processing: ${ parseFloat( ( p * 100 ).toFixed( 2 ) ) }%`;

				},
			} )
			.then( result => {

				geometry = result;

			} );

		while ( geometry === null ) {

			yield;

		}

	}

	const trimTime = window.performance.now() - timeStart;

	projection.geometry.dispose();
	projection.geometry = geometry;
	outputContainer.innerText =
		`merge geometry  : ${ mergeTime.toFixed( 2 ) }ms\n` +
		`edge trimming   : ${ trimTime.toFixed( 2 ) }ms`;

}


function render() {

	requestAnimationFrame( render );

	if ( task ) {

		const res = task.next();
		if ( res.done ) {

			task = null;

		}

	}

	model.visible = params.displayModel === 'color';
	shadedWhiteModel.visible = params.displayModel === 'shaded white';
	whiteModel.visible = params.displayModel === 'white';
	lines.visible = params.displayEdges;
	projection.visible = params.displayProjection;

	renderer.render( scene, camera );

}

function updateModelEdges() {

	if ( lines ) {

		group.remove( lines );
		lines.traverse( c => {

			if ( c.geometry ) c.geometry.dispose();
			if ( c.material ) c.material.dispose();

		} );

	}

	lines = new Group();
	model.traverse( c => {

		if ( c.geometry ) {

			const edges = generateEdges( c.geometry, undefined, params.angleThreshold );
			const points = edges.flatMap( line => [ line.start, line.end ] );
			const geom = new BufferGeometry();
			geom.setFromPoints( points );

			const geomLines = new LineSegments( geom, new LineBasicMaterial( { color: 0x030303 } ) );
			geomLines.position.copy( c.position );
			geomLines.quaternion.copy( c.quaternion );
			geomLines.scale.copy( c.scale );
			lines.add( geomLines );

		}

	} );
	lines.visible = params.displayEdges;
	group.add( lines );

}
