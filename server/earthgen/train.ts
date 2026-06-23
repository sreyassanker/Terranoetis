import { EarthGenModel } from './earthGen';
import { EarthGenDataset } from './dataset';

interface CLIOptions {
  source: string;
  epochs: number;
  lr: number;
  numSamples: number;
  checkpointDir: string;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    source: 'synthetic',
    epochs: 100,
    lr: 0.001,
    numSamples: 100,
    checkpointDir: './checkpoints',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && i + 1 < args.length) options.source = args[i + 1];
    if (args[i] === '--epochs' && i + 1 < args.length) options.epochs = parseInt(args[i + 1]);
    if (args[i] === '--lr' && i + 1 < args.length) options.lr = parseFloat(args[i + 1]);
    if (args[i] === '--num-samples' && i + 1 < args.length) options.numSamples = parseInt(args[i + 1]);
    if (args[i] === '--checkpoint-dir' && i + 1 < args.length) options.checkpointDir = args[i + 1];
  }

  return options;
}

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log(`EarthGen Training Pipeline`);
  console.log(`=========================`);
  console.log(`Source: ${opts.source}`);
  console.log(`Epochs: ${opts.epochs}`);
  console.log(`Learning Rate: ${opts.lr}`);
  console.log(`Samples: ${opts.numSamples}`);
  console.log(`Checkpoint Dir: ${opts.checkpointDir}`);
  console.log(``);

  const model = new EarthGenModel({
    learningRate: opts.lr,
    latentDim: 128,
    numLatentTokens: 512,
    numHeads: 4,
    numLayers: 6,
    hiddenDim: 256,
  });

  const dataset = new EarthGenDataset({ numPoints: 4096 });
  let syntheticExamples: DatasetExample[] = [];

  if (opts.source === 'earthquakes' || opts.source === 'synthetic') {
    syntheticExamples = dataset.syntheticEarthquakeDataset(opts.numSamples);
    console.log(`Generated ${syntheticExamples.length} synthetic earthquake point clouds`);
  }

  let bestValLoss = Infinity;
  let epochsNoImprove = 0;
  const PATIENCE = 20;

  await model.train(syntheticExamples, opts.epochs, (epoch, loss, valLoss) => {
    const bar = progressBar(epoch, opts.epochs);
    console.log(`Epoch ${String(epoch).padStart(4)}/${opts.epochs} ${bar} loss=${loss.toFixed(6)} val_loss=${valLoss.toFixed(6)}`);

    if (valLoss < bestValLoss) {
      bestValLoss = valLoss;
      epochsNoImprove = 0;
      const ckptPath = `${opts.checkpointDir}/earthgen_epoch${epoch}.json`;
      model.save(ckptPath);
    } else {
      epochsNoImprove++;
    }

    if ((epoch + 1) % 10 === 0) {
      const ckptPath = `${opts.checkpointDir}/earthgen_epoch${epoch}.json`;
      model.save(ckptPath);
    }
  });

  if (epochsNoImprove >= PATIENCE) {
    console.log(`Early stopping triggered after ${opts.epochs - epochsNoImprove} epochs without improvement`);
  }

  model.save(`${opts.checkpointDir}/earthgen_final.json`);
  console.log(`Training complete. Final checkpoint saved.`);
}

function progressBar(current: number, total: number, width = 30): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

main().catch(e => {
  console.error('Training failed:', e);
  process.exit(1);
});
