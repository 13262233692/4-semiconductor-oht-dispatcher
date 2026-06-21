import { Injectable, Logger } from '@nestjs/common';
import { DtwResult } from '../common/types';

@Injectable()
export class DtwService {
  private readonly logger = new Logger(DtwService.name);

  compute(
    seriesA: number[],
    seriesB: number[],
    windowSize?: number,
  ): DtwResult {
    const n = seriesA.length;
    const m = seriesB.length;

    if (n === 0 || m === 0) {
      return {
        distance: Infinity,
        costMatrix: [],
        warpPath: [],
        normalizedDistance: Infinity,
      };
    }

    const w = windowSize ?? Math.max(Math.abs(n - m), Math.floor(Math.max(n, m) * 0.3));

    const dtw: number[][] = [];
    for (let i = 0; i <= n; i++) {
      dtw[i] = new Array(m + 1).fill(Infinity);
    }
    dtw[0][0] = 0;

    for (let i = 1; i <= n; i++) {
      const jStart = Math.max(1, i - w);
      const jEnd = Math.min(m, i + w);
      for (let j = jStart; j <= jEnd; j++) {
        const cost = Math.abs(seriesA[i - 1] - seriesB[j - 1]);
        dtw[i][j] = cost + Math.min(
          dtw[i - 1][j],
          dtw[i][j - 1],
          dtw[i - 1][j - 1],
        );
      }
    }

    const warpPath: Array<[number, number]> = [];
    let i = n;
    let j = m;

    while (i > 0 && j > 0) {
      warpPath.unshift([i - 1, j - 1]);
      const costDiag = dtw[i - 1][j - 1];
      const costUp = dtw[i - 1][j];
      const costLeft = dtw[i][j - 1];

      if (costDiag <= costUp && costDiag <= costLeft) {
        i--;
        j--;
      } else if (costUp <= costLeft) {
        i--;
      } else {
        j--;
      }
    }

    const distance = dtw[n][m];
    const pathLength = warpPath.length;
    const normalizedDistance = pathLength > 0 ? distance / pathLength : Infinity;

    return {
      distance,
      costMatrix: dtw,
      warpPath,
      normalizedDistance,
    };
  }

  computeFast(seriesA: number[], seriesB: number[]): number {
    const n = seriesA.length;
    const m = seriesB.length;

    if (n === 0 || m === 0) return Infinity;

    const w = Math.max(Math.abs(n - m), Math.floor(Math.max(n, m) * 0.3));

    let prev = new Array(m + 1).fill(Infinity);
    let curr = new Array(m + 1).fill(Infinity);
    prev[0] = 0;

    for (let i = 1; i <= n; i++) {
      curr[0] = Infinity;
      const jStart = Math.max(1, i - w);
      const jEnd = Math.min(m, i + w);
      for (let j = jStart; j <= jEnd; j++) {
        const cost = Math.abs(seriesA[i - 1] - seriesB[j - 1]);
        curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      }
      [prev, curr] = [curr, prev];
    }

    return prev[m];
  }

  zNormalize(series: number[]): number[] {
    if (series.length === 0) return [];
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const variance = series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length;
    const std = Math.sqrt(variance) || 1;
    return series.map((v) => (v - mean) / std);
  }

  minMaxNormalize(series: number[]): number[] {
    if (series.length === 0) return [];
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    return series.map((v) => (v - min) / range);
  }

  resample(series: number[], targetLength: number): number[] {
    if (series.length === 0 || targetLength <= 0) return [];
    if (series.length === targetLength) return [...series];

    const result: number[] = [];
    const step = (series.length - 1) / (targetLength - 1);

    for (let i = 0; i < targetLength; i++) {
      const pos = i * step;
      const idx = Math.floor(pos);
      const frac = pos - idx;

      if (idx >= series.length - 1) {
        result.push(series[series.length - 1]);
      } else {
        result.push(series[idx] * (1 - frac) + series[idx + 1] * frac);
      }
    }

    return result;
  }

  smooth(series: number[], windowSize: number = 5): number[] {
    if (series.length === 0 || windowSize <= 1) return [...series];
    const half = Math.floor(windowSize / 2);
    const result: number[] = [];

    for (let i = 0; i < series.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(series.length - 1, i + half); j++) {
        sum += series[j];
        count++;
      }
      result.push(sum / count);
    }

    return result;
  }

  compareWaveforms(
    testWaveform: number[],
    baselineWaveform: number[],
    normalize: boolean = true,
  ): { distance: number; normalizedDistance: number; similarityScore: number } {
    const targetLen = Math.min(testWaveform.length, baselineWaveform.length);
    const testResampled = this.resample(testWaveform, targetLen);
    const baselineResampled = this.resample(baselineWaveform, targetLen);

    const test = normalize ? this.zNormalize(testResampled) : testResampled;
    const baseline = normalize ? this.zNormalize(baselineResampled) : baselineResampled;

    const distance = this.computeFast(test, baseline);
    const normalizedDistance = distance / targetLen;

    const maxPossibleDistance = targetLen * 4;
    const similarityScore = Math.max(0, Math.min(100, (1 - distance / maxPossibleDistance) * 100));

    return {
      distance,
      normalizedDistance,
      similarityScore,
    };
  }
}
