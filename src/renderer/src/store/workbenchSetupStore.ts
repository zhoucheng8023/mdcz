import type { MediaCandidate } from "@shared/types";
import { create } from "zustand";

export type WorkbenchSetupScanStatus = "idle" | "scanning" | "success" | "error";

interface WorkbenchSetupState {
  scanDir: string;
  targetDir: string;
  candidates: MediaCandidate[];
  selectedPaths: string[];
  scanStatus: WorkbenchSetupScanStatus;
  scanError: string;
  lastScannedDir: string;
  supportedExtensions: string[];

  setScanDir: (scanDir: string) => void;
  setTargetDir: (targetDir: string) => void;
  beginScan: (scanDir: string) => void;
  applyScanResult: (scanDir: string, candidates: MediaCandidate[], supportedExtensions: string[]) => void;
  failScan: (scanDir: string, error: string) => void;
  toggleSelectedPath: (path: string) => void;
  setAllSelected: (selected: boolean) => void;
}

export const useWorkbenchSetupStore = create<WorkbenchSetupState>((set) => ({
  scanDir: "",
  targetDir: "",
  candidates: [],
  selectedPaths: [],
  scanStatus: "idle",
  scanError: "",
  lastScannedDir: "",
  supportedExtensions: [],

  setScanDir: (scanDir) =>
    set({
      scanDir,
      candidates: [],
      selectedPaths: [],
      scanStatus: scanDir ? "idle" : "success",
      scanError: "",
      lastScannedDir: "",
    }),

  setTargetDir: (targetDir) => set({ targetDir }),

  beginScan: (scanDir) =>
    set({
      scanDir,
      candidates: [],
      selectedPaths: [],
      scanStatus: "scanning",
      scanError: "",
      lastScannedDir: scanDir,
    }),

  applyScanResult: (scanDir, candidates, supportedExtensions) =>
    set({
      scanDir,
      candidates,
      selectedPaths: candidates.map((candidate) => candidate.path),
      scanStatus: "success",
      scanError: "",
      lastScannedDir: scanDir,
      supportedExtensions,
    }),

  failScan: (scanDir, error) =>
    set({
      scanDir,
      candidates: [],
      selectedPaths: [],
      scanStatus: "error",
      scanError: error,
      lastScannedDir: scanDir,
    }),

  toggleSelectedPath: (path) =>
    set((state) => ({
      selectedPaths: state.selectedPaths.includes(path)
        ? state.selectedPaths.filter((selectedPath) => selectedPath !== path)
        : [...state.selectedPaths, path],
    })),

  setAllSelected: (selected) =>
    set((state) => ({
      selectedPaths: selected ? state.candidates.map((candidate) => candidate.path) : [],
    })),
}));
