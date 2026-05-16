"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";

type Step = 0 | 1 | 2;

type ManualExperiment = {
  infra: {
    controller: "ryu" | "onos" | "faucet";
    switchCount: number;
    hostCount: number;
  };
  traffic: {
    profile: "udp_flood" | "tcp_bulk" | "mixed";
    durationS: number;
    targetMbps: number;
  };
  telemetry: {
    layer: "L0" | "L1" | "L2" | "L3";
    samplingMs: number;
    exportJsonl: boolean;
  };
};

const defaultState: ManualExperiment = {
  infra: { controller: "ryu", switchCount: 2, hostCount: 4 },
  traffic: { profile: "mixed", durationS: 120, targetMbps: 300 },
  telemetry: { layer: "L2", samplingMs: 250, exportJsonl: true },
};

export function ManualExperimentWizard({
  onClose,
}: {
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(0);
  const [state, setState] = useState<ManualExperiment>(defaultState);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const stepLabel = useMemo(() => {
    if (step === 0) return "Infra";
    if (step === 1) return "Tráfego";
    return "Telemetria";
  }, [step]);

  return (
    <Card className="h-fit">
      <CardHeader
        title="Novo Experimento Manual"
        right={<span className="font-mono">step {step + 1}/3 · {stepLabel}</span>}
      />
      <CardBody className="space-y-4">
        {step === 0 ? (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="mb-1 text-[11px] font-medium text-fg-1">Controlador</div>
              <Select
                value={state.infra.controller}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    infra: { ...p.infra, controller: e.target.value as any },
                  }))
                }
              >
                <option value="ryu">ryu</option>
                <option value="onos">onos</option>
                <option value="faucet">faucet</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[11px] font-medium text-fg-1"># Switches</div>
                <Input
                  type="number"
                  min={1}
                  value={state.infra.switchCount}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      infra: { ...p.infra, switchCount: Number(e.target.value) },
                    }))
                  }
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-fg-1"># Hosts</div>
                <Input
                  type="number"
                  min={1}
                  value={state.infra.hostCount}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      infra: { ...p.infra, hostCount: Number(e.target.value) },
                    }))
                  }
                />
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="mb-1 text-[11px] font-medium text-fg-1">Perfil</div>
              <Select
                value={state.traffic.profile}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    traffic: { ...p.traffic, profile: e.target.value as any },
                  }))
                }
              >
                <option value="udp_flood">udp_flood</option>
                <option value="tcp_bulk">tcp_bulk</option>
                <option value="mixed">mixed</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[11px] font-medium text-fg-1">Duração (s)</div>
                <Input
                  type="number"
                  min={10}
                  value={state.traffic.durationS}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      traffic: { ...p.traffic, durationS: Number(e.target.value) },
                    }))
                  }
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-fg-1">Alvo (Mbps)</div>
                <Input
                  type="number"
                  min={1}
                  value={state.traffic.targetMbps}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      traffic: { ...p.traffic, targetMbps: Number(e.target.value) },
                    }))
                  }
                />
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid grid-cols-1 gap-3">
            <div>
              <div className="mb-1 text-[11px] font-medium text-fg-1">Camada</div>
              <Select
                value={state.telemetry.layer}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    telemetry: { ...p.telemetry, layer: e.target.value as any },
                  }))
                }
              >
                <option value="L0">L0</option>
                <option value="L1">L1</option>
                <option value="L2">L2</option>
                <option value="L3">L3</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-[11px] font-medium text-fg-1">Sampling (ms)</div>
                <Input
                  type="number"
                  min={50}
                  value={state.telemetry.samplingMs}
                  onChange={(e) =>
                    setState((p) => ({
                      ...p,
                      telemetry: { ...p.telemetry, samplingMs: Number(e.target.value) },
                    }))
                  }
                />
              </div>
              <div className="flex items-end">
                <label className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border border-border-0/60 bg-bg-2/20 px-2 text-[12px] text-fg-1">
                  <input
                    type="checkbox"
                    checked={state.telemetry.exportJsonl}
                    onChange={(e) =>
                      setState((p) => ({
                        ...p,
                        telemetry: { ...p.telemetry, exportJsonl: e.target.checked },
                      }))
                    }
                  />
                  Export JSONL
                </label>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-border-0/50 pt-3">
          <div className="text-[11px] text-fg-1">
            {lastRun ? <span className="font-mono">last_run={lastRun}</span> : <span>—</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Fechar
            </Button>
            <Button
              variant="ghost"
              onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
              disabled={step === 0}
            >
              Voltar
            </Button>
            {step < 2 ? (
              <Button onClick={() => setStep((s) => ((s + 1) as Step))}>Próximo</Button>
            ) : (
              <Button
                onClick={() => {
                  setLastRun(new Date().toISOString());
                }}
              >
                Executar
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border-0/60 bg-bg-2/20 p-3">
          <div className="mb-1 text-[11px] font-medium text-fg-1">Preview (JSON)</div>
          <pre className="max-h-48 overflow-auto text-[11px] leading-relaxed text-fg-0">
            {JSON.stringify(state, null, 2)}
          </pre>
        </div>
      </CardBody>
    </Card>
  );
}
