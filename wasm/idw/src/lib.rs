use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct KdNode {
    point: (f64, f64, f64),
    left: Option<Box<KdNode>>,
    right: Option<Box<KdNode>>,
    axis: usize,
}

#[wasm_bindgen]
pub struct KdTree {
    root: Option<Box<KdNode>>,
}

#[wasm_bindgen]
pub struct Neighbor {
    pub lat: f64,
    pub lon: f64,
    pub value: f64,
    pub dist_sq: f64,
}

#[wasm_bindgen]
impl KdTree {
    pub fn new() -> KdTree {
        KdTree { root: None }
    }

    pub fn build(lats: &[f64], lons: &[f64], values: &[f64]) -> KdTree {
        let mut points: Vec<(f64, f64, f64)> = lats
            .iter()
            .zip(lons.iter())
            .zip(values.iter())
            .map(|((&lat, &lon), &val)| (lat, lon, val))
            .collect();
        let root = build_rec(&mut points, 0);
        KdTree { root }
    }

    pub fn nearest_k(&self, lat: f64, lon: f64, k: usize) -> Vec<Neighbor> {
        let mut heap: Vec<Neighbor> = Vec::new();
        if let Some(ref root) = self.root {
            search_k(root, lat, lon, k, &mut heap, 0);
        }
        heap.sort_by(|a, b| a.dist_sq.partial_cmp(&b.dist_sq).unwrap());
        heap.truncate(k);
        heap
    }
}

fn build_rec(points: &mut [(f64, f64, f64)], depth: usize) -> Option<Box<KdNode>> {
    if points.is_empty() {
        return None;
    }
    let axis = depth % 3;
    points.sort_by(|a, b| {
        let va = match axis {
            0 => a.0,
            1 => a.1,
            _ => a.2,
        };
        let vb = match axis {
            0 => b.0,
            1 => b.1,
            _ => b.2,
        };
        va.partial_cmp(&vb).unwrap()
    });
    let mid = points.len() / 2;
    let (left, rest) = points.split_at_mut(mid);
    let (node, right) = rest.split_at_mut(1);
    Some(Box::new(KdNode {
        point: node[0],
        left: build_rec(left, depth + 1),
        right: build_rec(right, depth + 1),
        axis,
    }))
}

fn search_k(
    node: &KdNode,
    lat: f64,
    lon: f64,
    k: usize,
    heap: &mut Vec<Neighbor>,
    depth: usize,
) {
    let (nx, ny, nz) = node.point;
    let dx = match depth % 3 {
        0 => lat - nx,
        1 => lon - ny,
        _ => 0.0,
    };
    let d_sq = (lat - nx).powi(2) + (lon - ny).powi(2);
    let axis = depth % 3;

    let (near, far) = if dx < 0.0 {
        (&node.left, &node.right)
    } else {
        (&node.right, &node.left)
    };

    if let Some(ref n) = near {
        search_k(n, lat, lon, k, heap, depth + 1);
    }

    let dist_sq_val = match axis {
        0 => (lat - node.point.0).powi(2),
        1 => (lon - node.point.1).powi(2),
        _ => f64::MAX,
    };

    if heap.len() < k || d_sq < heap.last().unwrap_or(&Neighbor { lat: 0.0, lon: 0.0, value: 0.0, dist_sq: f64::MAX }).dist_sq {
        heap.push(Neighbor {
            lat: nx,
            lon: ny,
            value: nz,
            dist_sq: d_sq,
        });
        heap.sort_by(|a, b| a.dist_sq.partial_cmp(&b.dist_sq).unwrap());
        heap.truncate(k);
    }

    if heap.len() < k || dist_sq_val < heap.last().unwrap_or(&Neighbor { lat: 0.0, lon: 0.0, value: 0.0, dist_sq: f64::MAX }).dist_sq {
        if let Some(ref f) = far {
            search_k(f, lat, lon, k, heap, depth + 1);
        }
    }
}

#[wasm_bindgen]
pub fn interpolate_idw(
    lats: &[f64],
    lons: &[f64],
    values: &[f64],
    grid_lat_min: f64,
    grid_lat_max: f64,
    grid_lon_min: f64,
    grid_lon_max: f64,
    grid_width: u32,
    grid_height: u32,
    power: f64,
    neighbors: usize,
) -> Vec<f64> {
    let tree = KdTree::build(lats, lons, values);
    let mut output = Vec::with_capacity((grid_width * grid_height) as usize);
    let lat_step = (grid_lat_max - grid_lat_min) / (grid_height as f64 - 1.0);
    let lon_step = (grid_lon_max - grid_lon_min) / (grid_width as f64 - 1.0);

    for row in 0..grid_height {
        let lat = grid_lat_min + row as f64 * lat_step;
        for col in 0..grid_width {
            let lon = grid_lon_min + col as f64 * lon_step;
            let nbrs = tree.nearest_k(lat, lon, neighbors.min(values.len()));
            let mut weight_sum = 0.0;
            let mut value_sum = 0.0;
            let mut hit = false;
            for n in &nbrs {
                if n.dist_sq < 1e-12 {
                    value_sum = n.value;
                    weight_sum = 1.0;
                    hit = true;
                    break;
                }
                let w = 1.0 / n.dist_sq.powf(power / 2.0);
                weight_sum += w;
                value_sum += w * n.value;
            }
            output.push(if weight_sum > 0.0 { value_sum / weight_sum } else { 0.0 });
        }
    }
    output
}
