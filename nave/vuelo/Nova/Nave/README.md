<div align="center">

# Deployment `Nave`

**The F Prime deployment that runs NOVA's crew health monitor on the ship.**

<img src="https://img.shields.io/badge/F%20Prime-NASA%20JPL-0b3d91?style=for-the-badge" alt="F Prime (NASA JPL)">
<img src="https://img.shields.io/badge/topology-Nave-0b3d91?style=for-the-badge" alt="Topology Nave">
<img src="https://img.shields.io/badge/link-CCSDS%20over%20TCP-455a64?style=for-the-badge" alt="CCSDS over TCP">

</div>

`Nave` (Spanish for *ship*) is the single deployment of the `Nova` F Prime project. It combines the F Prime core
subtopologies with NOVA's three runtime components (`Estacion`, `MonitorSalud`, `Pantalla`) and wires them into one
binary. For what the components do, see the [flight core README](../../README.md).

## Topology

```mermaid
flowchart TB
  T["timer: LinuxTimer<br/>1 Hz base"] --> RGD["rateGroupDriver<br/>divisors 1, 2, 4"]
  RGD --> RG1["rateGroup_1Hz"]
  RGD --> RG05["rateGroup_0_5Hz"]
  RGD --> RG025["rateGroup_0_25Hz"]
  RG1 --> CORE1["tlmSend, fileDownlink, systemResources,<br/>comQueue, aggregator, cmdDisp"]
  RG1 --> EST["estacion"]
  RG1 --> MON["monitorSalud"]
  RG1 --> PAN["pantalla"]
  RG05 --> SEQ["cmdSeq"]
  RG025 --> CORE025["health, buffer managers,<br/>dpWriter, dpMgr"]
  EST -- "signoOut" --> MON
  MON -- "estadoOut, alertaOut" --> PAN
  PAN -- "signoOut" --> MON
  COM["ComCcsds + comDriver: TcpClient"] <--> GDS["fprime-gds"]
```

Core subtopologies imported in [`Top/topology.fpp`](Top/topology.fpp):

| Subtopology | Provides |
|---|---|
| `CdhCore` | command dispatcher, event manager, telemetry, text logger, health, fatal handling |
| `ComCcsds` | CCSDS framing, uplink and downlink queues, router, com stub |
| `FileHandling` | file uplink and downlink, parameter database (`PrmDb.dat`) |
| `DataProducts` | data product catalog, writer and manager |

The NOVA-specific wiring is the `connections Nave` block:

```
estacion.signoOut      -> monitorSalud.signoIn
monitorSalud.estadoOut -> pantalla.estadoIn
monitorSalud.alertaOut -> pantalla.alertaIn
pantalla.signoOut      -> monitorSalud.signoIn
```

Project configuration in [`Top/NaveTopology.cpp`](Top/NaveTopology.cpp): the command sequencer gets a 5 KB buffer,
the parameter database reads `PrmDb.dat`, `estacion` listens on UDP 50050, and `pantalla` sends to UDP 50051 and
listens on UDP 50052. Parameters are read from the file and loaded before the tasks start, so thresholds changed from
Earth and saved with `PRM_SAVE_FILE` survive a restart.

## Build and run

From this folder, with the F Prime virtual environment active (see the [flight core README](../../README.md#run-it)
for setting it up):

```sh
fprime-util generate
fprime-util build -j
```

Start the ground system together with the binary. This is what the ship link does automatically:

```sh
fprime-gds -g html --gui-port 5080
```

Ground system only, without starting the app:

```sh
fprime-gds --no-app
```

Then run the binary on its own from the build output and point it at the GDS:

```sh
cd build-artifacts/<platform>/bin/
./Nave -a 127.0.0.1 -p 50000
```

`Main.cpp` accepts `-a` (GDS host) and `-p` (port). Without both, the TCP link is not opened and the deployment runs
standalone: it still listens for the station and still feeds the crew screen. `Ctrl-C` stops the rate groups and
tears the topology down cleanly.

## Files

| File | Contents |
|---|---|
| `Main.cpp` | command-line entry: options, signal handling, topology setup and teardown |
| `Top/topology.fpp` | instances, subtopology imports, all connections |
| `Top/instances.fpp` | instance types, base IDs, queue sizes, priorities |
| `Top/NaveTopology.cpp` | rate group timing and project-specific configuration (ports, buffers, parameter file) |
| `Top/NavePackets.fppi` | telemetry packet definitions, kept for a future `TlmPacketizer` (not included today) |
| `fprime-gds.yml` | default GDS options (none set) |
| `CMakeLists.txt` | registers the deployment and its topology |

---

[Flight core](../../README.md) · [Ship overview](../../../README.md) · [Back to the main README](../../../../README.md)
