import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type {
  DesignSpec,
  Direction,
  RoomType,
  VastuPreferences,
} from "@/lib/design-types";

export const Route = createFileRoute("/design/new")({
  head: () => ({
    meta: [
      { title: "New design — Vaastu Studio" },
      { name: "description", content: "Describe your dream home through a guided wizard." },
    ],
  }),
  component: () => (
    <RequireAuth>
      <NewDesignWizard />
    </RequireAuth>
  ),
});

const DIRECTIONS: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const DEFAULT_ROOMS: { type: RoomType; label: string }[] = [
  { type: "living", label: "Living room" },
  { type: "kitchen", label: "Kitchen" },
  { type: "dining", label: "Dining" },
  { type: "master_bedroom", label: "Master bedroom" },
  { type: "bedroom", label: "Bedroom" },
  { type: "bath", label: "Bathroom" },
  { type: "pooja", label: "Pooja / prayer room" },
  { type: "study", label: "Study" },
  { type: "courtyard", label: "Courtyard" },
];

function NewDesignWizard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [spec, setSpec] = useState<DesignSpec>({
    plot: { widthFt: 40, depthFt: 60, shape: "rectangle", facing: "E" },
    floors: 2,
    rooms: [
      { type: "living", count: 1, sizePref: "large" },
      { type: "kitchen", count: 1, sizePref: "medium" },
      { type: "master_bedroom", count: 1, sizePref: "large" },
      { type: "bedroom", count: 2, sizePref: "medium" },
      { type: "bath", count: 2, sizePref: "small" },
    ],
    curvature: "mixed",
    roofStyle: "domed",
    windowDensity: "medium",
    exteriorFeel: "Warm earthy palette, natural textures",
    lifestyle: { familySize: 4, workFromHome: true, entertaining: false, notes: "" },
  });

  const [vastu, setVastu] = useState<VastuPreferences>({
    follow: "flexible",
    entranceDirection: "E",
    poojaRoom: true,
    poojaDirection: "NE",
    kitchenDirection: "SE",
    masterBedroomDirection: "SW",
    waterDirection: "NE",
    courtyard: false,
    notes: "",
  });

  const [name, setName] = useState("My dream home");

  function setRoom(type: RoomType, patch: Partial<{ count: number; sizePref: "small" | "medium" | "large" }>) {
    setSpec((s) => {
      const existing = s.rooms.find((r) => r.type === type);
      const others = s.rooms.filter((r) => r.type !== type);
      const next = existing
        ? { ...existing, ...patch }
        : { type, count: 1, sizePref: "medium" as const, ...patch };
      const cleaned = next.count > 0 ? [...others, next] : others;
      return { ...s, rooms: cleaned };
    });
  }

  async function handleSubmit() {
    if (!user) return;
    setSubmitting(true);
    const { data, error } = await supabase
      .from("designs")
      .insert({
        user_id: user.id,
        name,
        spec: spec as never,
        vastu_preferences: vastu as never,
        status: "spec_complete",
      })
      .select("id")
      .single();
    setSubmitting(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not save design");
      return;
    }
    toast.success("Spec saved — let's refine it");
    void navigate({ to: "/design/$id/refine", params: { id: data.id } });
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-wider text-accent mb-2">Step {step} of 4</p>
          <h1 className="text-3xl font-display">Tell us about your home</h1>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 space-y-6">
          {step === 1 && (
            <>
              <h2 className="text-xl font-display">Plot & structure</h2>
              <div>
                <Label>Design name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <Label>Width (ft)</Label>
                  <Input
                    type="number"
                    min={15}
                    max={500}
                    value={spec.plot.widthFt}
                    onChange={(e) =>
                      setSpec({ ...spec, plot: { ...spec.plot, widthFt: Number(e.target.value) } })
                    }
                  />
                </div>
                <div>
                  <Label>Depth (ft)</Label>
                  <Input
                    type="number"
                    min={15}
                    max={500}
                    value={spec.plot.depthFt}
                    onChange={(e) =>
                      setSpec({ ...spec, plot: { ...spec.plot, depthFt: Number(e.target.value) } })
                    }
                  />
                </div>
                <div>
                  <Label>Floors</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={spec.floors}
                    onChange={(e) => setSpec({ ...spec, floors: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Plot shape</Label>
                  <Select
                    value={spec.plot.shape}
                    onValueChange={(v) =>
                      setSpec({ ...spec, plot: { ...spec.plot, shape: v as DesignSpec["plot"]["shape"] } })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rectangle">Rectangle</SelectItem>
                      <SelectItem value="L-shape">L-shape</SelectItem>
                      <SelectItem value="irregular">Irregular</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Plot faces</Label>
                  <Select
                    value={spec.plot.facing}
                    onValueChange={(v) =>
                      setSpec({ ...spec, plot: { ...spec.plot, facing: v as Direction } })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DIRECTIONS.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-xl font-display">Rooms</h2>
              <p className="text-sm text-muted-foreground">
                How many of each room do you need? We&apos;ll arrange them across {spec.floors}{" "}
                floor(s).
              </p>
              <div className="space-y-3">
                {DEFAULT_ROOMS.map((r) => {
                  const cur = spec.rooms.find((x) => x.type === r.type);
                  return (
                    <div key={r.type} className="grid grid-cols-12 items-center gap-3 py-2 border-b border-border last:border-0">
                      <div className="col-span-5 text-sm">{r.label}</div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={cur?.count ?? 0}
                          onChange={(e) => setRoom(r.type, { count: Number(e.target.value) })}
                        />
                      </div>
                      <div className="col-span-4">
                        <Select
                          value={cur?.sizePref ?? "medium"}
                          onValueChange={(v) =>
                            setRoom(r.type, { sizePref: v as "small" | "medium" | "large" })
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="small">Small</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="large">Large</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-xl font-display">Style & feel</h2>
              <div>
                <Label>Curvature</Label>
                <RadioGroup
                  value={spec.curvature}
                  onValueChange={(v) => setSpec({ ...spec, curvature: v as DesignSpec["curvature"] })}
                  className="grid sm:grid-cols-3 gap-2 mt-2"
                >
                  {(["gentle", "bold", "mixed"] as const).map((opt) => (
                    <label
                      key={opt}
                      className="border border-border rounded-lg p-3 cursor-pointer hover:bg-accent/5 flex items-center gap-2 capitalize"
                    >
                      <RadioGroupItem value={opt} />
                      {opt}
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Roof style</Label>
                  <Select
                    value={spec.roofStyle}
                    onValueChange={(v) => setSpec({ ...spec, roofStyle: v as DesignSpec["roofStyle"] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat">Flat</SelectItem>
                      <SelectItem value="domed">Domed</SelectItem>
                      <SelectItem value="sloped">Sloped</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Windows</Label>
                  <Select
                    value={spec.windowDensity}
                    onValueChange={(v) =>
                      setSpec({ ...spec, windowDensity: v as DesignSpec["windowDensity"] })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Few</SelectItem>
                      <SelectItem value="medium">Balanced</SelectItem>
                      <SelectItem value="high">Many</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Exterior feel</Label>
                <Textarea
                  value={spec.exteriorFeel}
                  onChange={(e) => setSpec({ ...spec, exteriorFeel: e.target.value })}
                  rows={3}
                  maxLength={500}
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Family size</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={spec.lifestyle.familySize}
                    onChange={(e) =>
                      setSpec({
                        ...spec,
                        lifestyle: { ...spec.lifestyle, familySize: Number(e.target.value) },
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2 pt-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={spec.lifestyle.workFromHome}
                      onCheckedChange={(c) =>
                        setSpec({
                          ...spec,
                          lifestyle: { ...spec.lifestyle, workFromHome: Boolean(c) },
                        })
                      }
                    />
                    Work from home
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={spec.lifestyle.entertaining}
                      onCheckedChange={(c) =>
                        setSpec({
                          ...spec,
                          lifestyle: { ...spec.lifestyle, entertaining: Boolean(c) },
                        })
                      }
                    />
                    Frequently host guests
                  </label>
                </div>
              </div>
              <div>
                <Label>Lifestyle notes</Label>
                <Textarea
                  value={spec.lifestyle.notes}
                  onChange={(e) =>
                    setSpec({ ...spec, lifestyle: { ...spec.lifestyle, notes: e.target.value } })
                  }
                  rows={2}
                  maxLength={500}
                />
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="text-xl font-display">Vastu preferences</h2>
              <div>
                <Label>How important is Vastu?</Label>
                <RadioGroup
                  value={vastu.follow}
                  onValueChange={(v) => setVastu({ ...vastu, follow: v as VastuPreferences["follow"] })}
                  className="grid sm:grid-cols-3 gap-2 mt-2"
                >
                  {(
                    [
                      { v: "strict", label: "Strict" },
                      { v: "flexible", label: "Flexible" },
                      { v: "none", label: "Not important" },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.v}
                      className="border border-border rounded-lg p-3 cursor-pointer hover:bg-accent/5 flex items-center gap-2"
                    >
                      <RadioGroupItem value={opt.v} />
                      {opt.label}
                    </label>
                  ))}
                </RadioGroup>
              </div>
              {vastu.follow !== "none" && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <DirectionField
                      label="Main entrance"
                      value={vastu.entranceDirection}
                      onChange={(d) => setVastu({ ...vastu, entranceDirection: d })}
                    />
                    <DirectionField
                      label="Kitchen"
                      value={vastu.kitchenDirection}
                      onChange={(d) => setVastu({ ...vastu, kitchenDirection: d })}
                    />
                    <DirectionField
                      label="Master bedroom"
                      value={vastu.masterBedroomDirection}
                      onChange={(d) => setVastu({ ...vastu, masterBedroomDirection: d })}
                    />
                    <DirectionField
                      label="Water / borewell"
                      value={vastu.waterDirection}
                      onChange={(d) => setVastu({ ...vastu, waterDirection: d })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={vastu.poojaRoom}
                        onCheckedChange={(c) => setVastu({ ...vastu, poojaRoom: Boolean(c) })}
                      />
                      Include pooja / prayer room
                    </label>
                    {vastu.poojaRoom && (
                      <DirectionField
                        label="Pooja direction"
                        value={vastu.poojaDirection}
                        onChange={(d) => setVastu({ ...vastu, poojaDirection: d })}
                      />
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={vastu.courtyard}
                        onCheckedChange={(c) => setVastu({ ...vastu, courtyard: Boolean(c) })}
                      />
                      Open courtyard
                    </label>
                  </div>
                  <div>
                    <Label>Other Vastu notes</Label>
                    <Textarea
                      value={vastu.notes ?? ""}
                      onChange={(e) => setVastu({ ...vastu, notes: e.target.value })}
                      rows={2}
                      maxLength={500}
                    />
                  </div>
                </>
              )}
            </>
          )}

          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
            >
              Back
            </Button>
            {step < 4 ? (
              <Button onClick={() => setStep((s) => s + 1)}>Continue</Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Saving…" : "Continue to AI refinement"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DirectionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: Direction;
  onChange: (d: Direction) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as Direction)}>
        <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
        <SelectContent>
          {DIRECTIONS.map((d) => (
            <SelectItem key={d} value={d}>{d}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
