/** Small position-based fluid solver. Metaballs are only its render surface;
 * particles retain velocities, incompressibility, cohesion and wall contacts. */
                                                         
                                                                   
export const FLUID_STEP = 1 / 90;
const H = .19, REST = 5.8, FLOOR = .038;

export class CabinFluid {
           count        ;
           positions              ;
           velocities              ;
          previous              ;
          lambdas              ;
          correction              ;
           origin        ;
           milk         ;
  impact = 0;
  impactPoint         = { x: 0, y: 0, z: 0 };
          splashed = false;
  active = false;
          point         = { x: 0, y: 0, z: 0 };

  constructor(origin        , milk = false, count = 88) {
    this.origin = { ...origin }; this.milk = milk; this.count = count;
    this.positions = new Float32Array(count * 3);
    this.previous = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.correction = new Float32Array(count * 3);
    this.lambdas = new Float32Array(count);
    this.reset();
  }
  reset() {
    // Deterministic, near-uniform volume sampling, not a hollow spherical shell.
    const lattice            =[];
    for(let x=-4;x<=4;x++)for(let y=-4;y<=4;y++)for(let z=-4;z<=4;z++)if((x+y+z)%2===0)lattice.push([x,y,z]);
    lattice.sort((a,b)=>a[0]*a[0]+a[1]*a[1]+a[2]*a[2]-b[0]*b[0]-b[1]*b[1]-b[2]*b[2]);
    for(let i=0;i<this.count;i++)this.positions.set([this.origin.x+lattice[i][0]*.065,this.origin.y+lattice[i][1]*.065,this.origin.z+lattice[i][2]*.065],i*3);
    this.velocities.fill(0); this.previous.set(this.positions); this.splashed = false; this.impact = 0; this.active = false;
  }
  center()         {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < this.positions.length; i += 3) { x += this.positions[i]; y += this.positions[i + 1]; z += this.positions[i + 2]; }
    return { x: x / this.count, y: y / this.count, z: z / this.count };
  }
  step(dt        , gravity         , target               , contact               ) {
    this.active = true;
    const p = this.positions, v = this.velocities, old = this.previous;
    old.set(p); this.impact = 0;
    const c = this.center();
    let vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < v.length; i += 3) { vx += v[i]; vy += v[i + 1]; vz += v[i + 2]; }
    vx /= this.count; vy /= this.count; vz /= this.count;
    const fx = target ? (target.x - c.x) * 65 - vx * 11 : 0;
    const fy = target ? (target.y - c.y) * 65 - vy * 11 : 0;
    const fz = target ? (target.z - c.z) * 65 - vz * 11 : 0;
    for (let k = 0; k < p.length; k += 3) {
      v[k] += fx * dt; v[k + 1] += (fy - (gravity ? 9.81 : 0)) * dt; v[k + 2] += fz * dt;
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
    }
    const hh = H * H;
    // PBF density constraints. Water tolerates easier separation than milk.
    for (let iteration = 0; iteration < 3; iteration++) {
      for (let i = 0; i < this.count; i++) {
        const a = i * 3;
        let rho = 1, gx = 0, gy = 0, gz = 0, sum = 0;
        for (let j = 0; j < this.count; j++) {
          if (i === j) continue;
          const b = j * 3, dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= hh) continue;
          const w = 1 - d2 / hh;
          rho += w * w * w;
          const factor = -6 * w * w / (hh * REST);
          const x = dx * factor, y = dy * factor, z = dz * factor;
          gx += x; gy += y; gz += z; sum += x * x + y * y + z * z;
        }
        const constraint = Math.max(rho / REST - 1, this.milk ? -.065 : -.025);
        this.lambdas[i] = -constraint / (sum + gx * gx + gy * gy + gz * gz + 30);
      }
      this.correction.fill(0);
      for (let i = 0; i < this.count; i++) {
        const a = i * 3;
        for (let j = i + 1; j < this.count; j++) {
          const b = j * 3, dx = p[a] - p[b], dy = p[a + 1] - p[b + 1], dz = p[a + 2] - p[b + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= hh || d2 < 1e-9) continue;
          const w = 1 - d2 / hh;
          const scorr = -.0005 * Math.pow(w * w * w / .753571, 4);
          const f = (this.lambdas[i] + this.lambdas[j] + scorr) * -6 * w * w / (hh * REST);
          const x = dx * f, y = dy * f, z = dz * f;
          this.correction[a] += x; this.correction[a + 1] += y; this.correction[a + 2] += z;
          this.correction[b] -= x; this.correction[b + 1] -= y; this.correction[b + 2] -= z;
        }
      }
      for (let a = 0; a < p.length; a += 3) {
        for (let axis = 0; axis < 3; axis++) p[a + axis] += Math.max(-.025, Math.min(.025, this.correction[a + axis]));
        p[a] = Math.max(-1.64, Math.min(1.64, p[a]));
        p[a + 1] = Math.max(FLOOR, Math.min(3.45, p[a + 1]));
        p[a + 2] = Math.max(-12, Math.min(1.5, p[a + 2]));
        if (contact && iteration === 2) {
          this.point.x = p[a]; this.point.y = p[a + 1]; this.point.z = p[a + 2];
          contact(this.point, .035);
          p[a] = this.point.x; p[a + 1] = Math.max(FLOOR, this.point.y); p[a + 2] = this.point.z;
        }
      }
    }
    for (let a = 0; a < p.length; a += 3) {
      for (let axis = 0; axis < 3; axis++) v[a + axis] = (p[a + axis] - old[a + axis]) / dt;
      if (gravity && p[a + 1] <= FLOOR + .008) {
        if (!this.splashed && old[a + 1] > FLOOR + .008 && vy < -1.2) {
          this.impact = Math.max(this.impact, -vy); this.impactPoint = { x: p[a], y: FLOOR, z: p[a + 2] };
        }
        const radial = this.milk ? .13 : .22;
        v[a] += (p[a] - c.x) * Math.max(0, -vy) * radial;
        v[a + 2] += (p[a + 2] - c.z) * Math.max(0, -vy) * radial;
        v[a + 1] = Math.max(0, v[a + 1]) * .06;
        v[a] *= this.milk ? .88 : .94; v[a + 2] *= this.milk ? .88 : .94;
      }
      const damping = gravity ? .999 : .985;
      v[a] *= damping; v[a + 1] *= damping; v[a + 2] *= damping;
    }
    if (this.impact > 0) this.splashed = true;
  }
}
