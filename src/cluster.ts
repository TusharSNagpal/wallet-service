import cluster from 'cluster';
import os from 'os';

const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  console.log(`master ${process.pid} started, forking ${numCPUs} workers`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code) => {
    console.log(`worker ${worker.process.pid} exited with code ${code}, restarting`);
    cluster.fork();
  });
} else {
  require('./index');
}
