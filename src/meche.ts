// MechE topic of the day: a rotating list of core mechanical engineering
// topics, each with a tiny, concrete first step. Weighted toward design,
// manufacturing and robotics.

export interface Topic {
  title: string
  step: string
}

export const MECHE_TOPICS: Topic[] = [
  { title: "Mohr's circle", step: 'Sketch the circle for sx=80, sy=-20, txy=30 MPa' },
  { title: 'Beam bending stress', step: 'Derive sigma = My/I for a rectangular section' },
  { title: 'Shear & moment diagrams', step: 'Draw V and M for a simply supported beam, center load' },
  { title: 'Torsion of shafts', step: 'Find max shear in a 20 mm shaft at 50 N*m' },
  { title: 'Buckling (Euler)', step: 'Compute Pcr for a pinned 1 m steel rod, d = 10 mm' },
  { title: 'Fatigue & S-N curves', step: 'Look up the endurance limit rule of thumb for steel' },
  { title: 'Failure theories', step: 'Compare von Mises vs Tresca for one stress state' },
  { title: 'GD&T basics', step: 'Learn what position tolerance with MMC means' },
  { title: 'Tolerance stack-ups', step: 'Do a worst-case stack for 3 parts in a row' },
  { title: 'Fits: clearance vs press', step: 'Look up an H7/g6 fit for a 10 mm shaft' },
  { title: 'Bolted joints', step: 'Find the preload for an M6 8.8 bolt' },
  { title: 'Gear trains', step: 'Compute the ratio of a 2-stage 20:60, 15:45 train' },
  { title: 'Bearings & L10 life', step: 'Compute L10 for C = 10 kN, P = 2 kN ball bearing' },
  { title: 'Belt & chain drives', step: 'Pick a timing belt for a 3:1 reduction' },
  { title: 'Motor sizing for robots', step: 'Find the torque to lift 1 kg on a 0.3 m arm' },
  { title: 'PID control', step: 'Write what P, I and D each do in one line each' },
  { title: 'Forward kinematics', step: 'Write the end position of a 2-link planar arm' },
  { title: 'Inverse kinematics', step: 'Solve the elbow angle of a 2-link arm' },
  { title: 'Rankine cycle', step: 'Draw the T-s diagram and label the 4 states' },
  { title: 'Refrigeration cycle', step: 'Define COP and find it for one textbook case' },
  { title: 'Heat conduction', step: 'Find q through a 10 cm wall, k = 0.5, dT = 20 K' },
  { title: 'Convection & h', step: 'Look up typical h for free vs forced air' },
  { title: 'Bernoulli & losses', step: 'Add a minor loss term to one Bernoulli problem' },
  { title: 'Pipe flow & Reynolds', step: 'Find Re for water at 1 m/s in a 25 mm pipe' },
  { title: 'Material selection (Ashby)', step: 'Find the index for a light, stiff beam' },
  { title: 'Injection molding DFM', step: 'Learn draft angle and uniform wall rules' },
  { title: 'CNC machining DFM', step: 'Learn why inside corners need a radius' },
  { title: 'Sheet metal design', step: 'Compute a bend allowance for 1.5 mm aluminum' },
  { title: '3D printing for parts', step: 'Compare FDM layer orientation vs strength' },
  { title: 'FEA basics', step: 'Write what a mesh convergence study checks' },
  { title: 'Vibrations: natural freq', step: 'Compute fn for k = 1000 N/m, m = 1 kg' },
  { title: 'Composites (laminates)', step: 'Look up why 0/90/45 layups are used' },
]

/** Same topic all day, a new one each day, cycling through the list. */
export function topicFor(dateKey: string): Topic {
  const [y, m, d] = dateKey.split('-').map(Number)
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
  return MECHE_TOPICS[((day % MECHE_TOPICS.length) + MECHE_TOPICS.length) % MECHE_TOPICS.length]
}

/** Mini checklist for a topic: the tiny step, then learn, apply, explain. */
export function topicChecklist(t: Topic): string[] {
  return [t.step, 'Write down the 2-3 key equations or rules', 'Work one example end to end', 'Explain it out loud in 60 seconds']
}
