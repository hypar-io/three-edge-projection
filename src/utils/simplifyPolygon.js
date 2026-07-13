/**
 * Ramer-Douglas-Peucker algorithm for simplifying polygons
 * Reduces vertex count while maintaining shape within tolerance
 */

function pointToLineDistance( point, lineStart, lineEnd ) {

	const x = point.x;
	const y = point.y;
	const x1 = lineStart.x;
	const y1 = lineStart.y;
	const x2 = lineEnd.x;
	const y2 = lineEnd.y;

	const A = x - x1;
	const B = y - y1;
	const C = x2 - x1;
	const D = y2 - y1;

	const dot = A * C + B * D;
	const lenSq = C * C + D * D;
	let param = - 1;

	if ( lenSq !== 0 ) {

		param = dot / lenSq;

	}

	let xx, yy;

	if ( param < 0 ) {

		xx = x1;
		yy = y1;

	} else if ( param > 1 ) {

		xx = x2;
		yy = y2;

	} else {

		xx = x1 + param * C;
		yy = y1 + param * D;

	}

	const dx = x - xx;
	const dy = y - yy;
	return Math.sqrt( dx * dx + dy * dy );

}

/**
 * Simplifies a polygon using the Ramer-Douglas-Peucker algorithm
 * @param {Array} points Array of points with {x, y} properties
 * @param {number} tolerance Maximum distance a point can be from the simplified line
 * @returns {Array} Simplified array of points
 */
export function simplifyPolygon( points, tolerance ) {

	if ( points.length <= 2 ) {

		return points;

	}

	const simplified = [];

	const rdp = ( start, end ) => {

		if ( end - start <= 1 ) {

			return;

		}

		const startPoint = points[ start ];
		const endPoint = points[ end ];

		let maxDistance = 0;
		let maxIndex = start;

		for ( let i = start + 1; i < end; i ++ ) {

			const distance = pointToLineDistance( points[ i ], startPoint, endPoint );
			if ( distance > maxDistance ) {

				maxDistance = distance;
				maxIndex = i;

			}

		}

		if ( maxDistance > tolerance ) {

			rdp( start, maxIndex );
			simplified.push( maxIndex );
			rdp( maxIndex, end );

		}

	};

	simplified.push( 0 );
	rdp( 0, points.length - 1 );
	simplified.push( points.length - 1 );

	// Sort indices and remove duplicates
	const uniqueIndices = [ ...new Set( simplified ) ].sort( ( a, b ) => a - b );

	// Return simplified points
	return uniqueIndices.map( ( idx ) => points[ idx ] );

}

/**
 * Simplifies multiple polygon loops
 */
export function simplifyPolygonLoops( loops, tolerance ) {

	return loops.map( ( loop ) => simplifyPolygon( loop, tolerance ) );

}

