import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import type { Agent, AgentStatus } from "../../types/agent";
import "./VirtualOfficeScene.css";

interface VirtualOfficeSceneProps {
  agents: readonly Agent[];
  selectedAgentId: string;
  onSelect: (agentId: string) => void;
  htmlPortal: RefObject<HTMLElement>;
}

const agentColors: Record<string, string> = {
  coordinator: "#7798e8",
  developer: "#54b99f",
  "code-reviewer": "#b18ad9",
  "security-reviewer": "#d6a45e",
};

const statusLabels: Record<AgentStatus, string> = {
  working: "Trabalhando",
  thinking: "Pensando",
  waiting: "Aguardando",
  paused: "Pausado",
  resting: "Descansando",
  completed: "Concluído",
  error: "Com erro",
};

const statusColors: Record<AgentStatus, string> = {
  working: "#55d6a2",
  thinking: "#8db5ff",
  waiting: "#d7bd7c",
  paused: "#a5adbd",
  resting: "#79c8d5",
  completed: "#83d3a0",
  error: "#ff8585",
};

const skinColor = "#e8b99a";

function Desk({
  position,
}: {
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      {/* Tampo da mesa */}
      <mesh position={[0, 0.82, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.75, 0.13, 0.95]} />
        <meshStandardMaterial color="#9a7558" roughness={0.72} />
      </mesh>

      {/* Pés */}
      {([-0.72, 0.72] as const).flatMap((x) =>
        ([-0.34, 0.34] as const).map((z) => (
          <mesh
            key={`${x}-${z}`}
            position={[x, 0.39, z]}
            castShadow
          >
            <boxGeometry args={[0.09, 0.78, 0.09]} />
            <meshStandardMaterial color="#614c40" roughness={0.8} />
          </mesh>
        ))
      )}

      {/* Monitor */}
      <mesh position={[0, 1.28, -0.25]} castShadow>
        <boxGeometry args={[0.78, 0.48, 0.07]} />
        <meshStandardMaterial
          color="#182536"
          roughness={0.35}
          metalness={0.25}
        />
      </mesh>

      <mesh position={[0, 1.28, -0.207]}>
        <planeGeometry args={[0.68, 0.37]} />
        <meshBasicMaterial color="#4d89a7" />
      </mesh>

      {/* Suporte do monitor */}
      <mesh position={[0, 1.02, -0.23]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color="#53677d" />
      </mesh>

      <mesh position={[0, 0.91, -0.02]}>
        <boxGeometry args={[0.46, 0.025, 0.28]} />
        <meshStandardMaterial color="#333e4e" />
      </mesh>

      {/* Cadeira */}
      <mesh position={[0, 0.42, 0.85]} castShadow>
        <boxGeometry args={[0.62, 0.12, 0.58]} />
        <meshStandardMaterial color="#34465d" />
      </mesh>

      <mesh position={[0, 0.78, 1.08]} castShadow>
        <boxGeometry args={[0.62, 0.62, 0.1]} />
        <meshStandardMaterial color="#40546d" />
      </mesh>
    </group>
  );
}

function CartoonAgent({
  agent,
  position,
  selected,
  onSelect,
  index,
  htmlPortal,
}: {
  agent: Agent;
  position: [number, number, number];
  selected: boolean;
  onSelect: () => void;
  index: number;
  htmlPortal: RefObject<HTMLElement>;
}) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);

  const color = agentColors[agent.id] ?? "#7798e8";
  const statusColor = statusColors[agent.status] ?? "#8db5ff";

  const fallbackNames: Record<string, string> = {
    coordinator: "Coordinator",
    developer: "Developer",
    "code-reviewer": "Code Reviewer",
    "security-reviewer": "Security Reviewer",
  };

  const displayName =
    typeof agent.name === "string" && agent.name.trim().length > 0
      ? agent.name.trim()
      : fallbackNames[agent.id] ?? agent.id;

  const hairColor =
    agent.id === "coordinator"
      ? "#45332d"
      : agent.id === "developer"
        ? "#302b35"
        : agent.id === "code-reviewer"
          ? "#5a4032"
          : "#292d38";

  const isReviewer = agent.id === "code-reviewer";
  const isCoordinator = agent.id === "coordinator";
  const isSecurity = agent.id === "security-reviewer";
  const isDeveloper = agent.id === "developer";

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;

    if (root.current) {
      root.current.position.y =
        position[1] + Math.sin(time * 2 + index) * 0.018;

      root.current.scale.setScalar(selected ? 1.045 : 1);
    }

    if (head.current) {
      head.current.rotation.z =
        agent.status === "thinking"
          ? Math.sin(time * 1.5) * 0.12
          : 0;
    }

    const typing = agent.status === "working";

    if (leftArm.current) {
      leftArm.current.rotation.x = typing
        ? Math.sin(time * 9 + index) * 0.22
        : -0.18;

      leftArm.current.rotation.z = 0.12;
    }

    if (rightArm.current) {
      rightArm.current.rotation.x = typing
        ? Math.sin(time * 9 + index + 1) * 0.22
        : -0.18;

      rightArm.current.rotation.z = -0.12;
    }
  });

  return (
    <group
      ref={root}
      position={position}
      rotation={[0, Math.PI, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {/* Base */}
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <cylinderGeometry args={[0.29, 0.31, 0.12, 20]} />
        <meshStandardMaterial color="#172438" roughness={0.9} />
      </mesh>

      {/* Pernas e calçados */}
      {([-0.14, 0.14] as const).map((x) => (
        <group key={x} position={[x, 0.34, 0]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.105, 0.34, 5, 12]} />
            <meshStandardMaterial color="#34445b" roughness={0.82} />
          </mesh>

          <mesh position={[0, -0.23, 0.075]} castShadow>
            <capsuleGeometry args={[0.105, 0.12, 4, 10]} />
            <meshStandardMaterial
              color={isSecurity ? "#252d3a" : "#e5eaf1"}
              roughness={0.75}
            />
          </mesh>

          <mesh position={[0, -0.29, 0.075]}>
            <boxGeometry args={[0.17, 0.035, 0.23]} />
            <meshStandardMaterial color="#b7c2d1" />
          </mesh>
        </group>
      ))}

      {/* Tronco */}
      <mesh position={[0, 0.88, 0]} castShadow>
        <capsuleGeometry args={[0.29, 0.49, 6, 16]} />
        <meshStandardMaterial color={color} roughness={0.82} />
      </mesh>

      {/* Camiseta */}
      <mesh position={[0, 0.88, 0.265]}>
        <boxGeometry args={[0.17, 0.45, 0.025]} />
        <meshStandardMaterial color="#e9edf5" roughness={0.85} />
      </mesh>

      {/* Detalhe da roupa */}
      <mesh position={[0, 0.76, 0.285]}>
        <boxGeometry args={[0.18, 0.13, 0.025]} />
        <meshStandardMaterial
          color={isSecurity ? "#60b9a5" : "#d8e1ec"}
          roughness={0.8}
        />
      </mesh>

      {/* Cinto */}
      <mesh position={[0, 0.54, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 0.055, 16]} />
        <meshStandardMaterial color="#293447" />
      </mesh>

      {/* Identidade visual do Coordinator */}
      {isCoordinator && (
        <mesh position={[0.19, 0.93, 0.27]}>
          <boxGeometry args={[0.12, 0.16, 0.035]} />
          <meshStandardMaterial color="#e8c46c" metalness={0.25} />
        </mesh>
      )}

      {/* Identidade visual do Security Reviewer */}
      {isSecurity && (
        <mesh position={[0.19, 0.91, 0.27]}>
          <sphereGeometry args={[0.075, 12, 10]} />
          <meshStandardMaterial
            color="#67c8a5"
            emissive="#1d664f"
            emissiveIntensity={0.3}
          />
        </mesh>
      )}

      {/* Identidade visual do Code Reviewer */}
      {isReviewer && (
        <mesh position={[-0.19, 0.93, 0.27]}>
          <boxGeometry args={[0.11, 0.15, 0.035]} />
          <meshStandardMaterial color="#e6c879" />
        </mesh>
      )}

      {/* Identidade visual do Developer */}
      {isDeveloper && (
        <mesh position={[0, 0.57, 0.27]}>
          <boxGeometry args={[0.13, 0.07, 0.025]} />
          <meshStandardMaterial color="#263c4c" />
        </mesh>
      )}

      {/* Braço esquerdo */}
      <group ref={leftArm} position={[-0.34, 1.04, 0]}>
        <mesh
          position={[-0.07, -0.23, 0]}
          rotation={[0, 0, -0.18]}
          castShadow
        >
          <capsuleGeometry args={[0.105, 0.34, 5, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>

        <mesh position={[-0.13, -0.45, 0.035]}>
          <sphereGeometry args={[0.105, 12, 10]} />
          <meshStandardMaterial color={skinColor} />
        </mesh>
      </group>

      {/* Braço direito */}
      <group ref={rightArm} position={[0.34, 1.04, 0]}>
        <mesh
          position={[0.07, -0.23, 0]}
          rotation={[0, 0, 0.18]}
          castShadow
        >
          <capsuleGeometry args={[0.105, 0.34, 5, 12]} />
          <meshStandardMaterial color={color} />
        </mesh>

        <mesh position={[0.13, -0.45, 0.035]}>
          <sphereGeometry args={[0.105, 12, 10]} />
          <meshStandardMaterial color={skinColor} />
        </mesh>
      </group>

      {/* Cabeça */}
      <group ref={head} position={[0, 1.51, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.34, 24, 20]} />
          <meshStandardMaterial color={skinColor} roughness={0.85} />
        </mesh>

        {/* Orelhas */}
        {([-0.32, 0.32] as const).map((x) => (
          <mesh key={x} position={[x, -0.015, 0]}>
            <sphereGeometry args={[0.075, 12, 10]} />
            <meshStandardMaterial color={skinColor} />
          </mesh>
        ))}

        {/* Cabelo */}
        <mesh
          position={[0, 0.22, -0.035]}
          scale={[1, 0.72, 0.95]}
          castShadow
        >
          <sphereGeometry args={[0.30, 20, 14]} />
          <meshStandardMaterial color={hairColor} roughness={0.95} />
        </mesh>

        {/* Franja */}
        <mesh
          position={[isCoordinator ? -0.09 : 0.06, 0.16, 0.235]}
          rotation={[0.12, 0, isCoordinator ? -0.2 : 0.15]}
        >
          <sphereGeometry args={[0.16, 16, 10]} />
          <meshStandardMaterial color={hairColor} />
        </mesh>

        {/* Olhos, íris e sobrancelhas */}
        {([-0.115, 0.115] as const).map((x) => (
          <group key={x} position={[x, 0.015, 0.292]}>
            <mesh>
              <sphereGeometry args={[0.063, 16, 12]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>

            <mesh position={[0, 0, 0.045]}>
              <sphereGeometry args={[0.034, 12, 10]} />
              <meshStandardMaterial color="#3b536f" />
            </mesh>

            <mesh position={[0, 0, 0.07]}>
              <sphereGeometry args={[0.016, 10, 8]} />
              <meshStandardMaterial color="#151c27" />
            </mesh>

            <mesh position={[0, 0.09, 0.005]}>
              <boxGeometry args={[0.12, 0.025, 0.025]} />
              <meshStandardMaterial color={hairColor} />
            </mesh>
          </group>
        ))}

        {/* Nariz */}
        <mesh position={[0, -0.055, 0.355]}>
          <sphereGeometry args={[0.045, 12, 10]} />
          <meshStandardMaterial color="#d99d80" />
        </mesh>

        {/* Boca */}
        <mesh position={[0, -0.15, 0.325]}>
          <capsuleGeometry args={[0.018, 0.065, 4, 8]} />
          <meshStandardMaterial color="#985e5c" />
        </mesh>

        {/* Óculos do Code Reviewer */}
        {isReviewer && (
          <group position={[0, 0.015, 0.337]}>
            {([-0.115, 0.115] as const).map((x) => (
              <mesh key={x} position={[x, 0, 0]}>
                <torusGeometry args={[0.09, 0.012, 8, 20]} />
                <meshStandardMaterial
                  color="#28394c"
                  metalness={0.6}
                />
              </mesh>
            ))}

            <mesh>
              <boxGeometry args={[0.09, 0.015, 0.018]} />
              <meshStandardMaterial color="#28394c" />
            </mesh>
          </group>
        )}
      </group>

      {/* Indicador de status */}
      <mesh position={[0, 2.02, 0]}>
        <sphereGeometry
          args={[selected ? 0.105 : 0.075, 16, 12]}
        />
        <meshStandardMaterial
          color={statusColor}
          emissive={statusColor}
          emissiveIntensity={0.65}
        />
      </mesh>

      {/* Painel flutuante com as informações do agente */}
      <group position={[0, 2.48, 0]}>
        <Html
          center
          distanceFactor={10}
          transform={false}
          occlude={false}
          portal={htmlPortal}
        >
          <div className={`scene-agent-label${selected ? " is-selected" : ""}`}>
            <strong>{displayName}</strong>

            <span>
              <i style={{ backgroundColor: statusColor }} />
              {statusLabels[agent.status]}
            </span>

            <small>
              {agent.currentTask ?? "Sem tarefa informada"}
            </small>
          </div>
        </Html>
      </group>
    </group>
  );
}

function OfficeEnvironment() {
  const deskPositions: [number, number, number][] = [
    [-3.15, 0, -1.45],
    [3.15, 0, -1.45],
    [-3.15, 0, 1.75],
    [3.15, 0, 1.75],
  ];

  return (
    <>
      {/* Piso */}
      <mesh position={[0, -0.22, 0]} receiveShadow>
        <boxGeometry args={[11.5, 0.35, 8.2]} />
        <meshStandardMaterial color="#273447" roughness={0.9} />
      </mesh>

      <gridHelper
        args={[11.5, 23, "#52647b", "#35465c"]}
        position={[0, -0.035, 0]}
      />

      {/* Parede do fundo */}
      <mesh position={[0, 1.05, -4.02]} receiveShadow>
        <boxGeometry args={[11.5, 2.2, 0.18]} />
        <meshStandardMaterial color="#35475d" roughness={0.9} />
      </mesh>

      {/* Parede lateral */}
      <mesh position={[-5.62, 1.05, 0]} receiveShadow>
        <boxGeometry args={[0.18, 2.2, 8.2]} />
        <meshStandardMaterial color="#304257" roughness={0.9} />
      </mesh>

      {/* Quatro mesas */}
      {deskPositions.map((position, index) => (
        <Desk key={index} position={position} />
      ))}

      {/* Balcão central */}
      <mesh position={[0, 0.08, 3.7]} castShadow>
        <boxGeometry args={[2.2, 0.18, 0.65]} />
        <meshStandardMaterial color="#53677d" />
      </mesh>

      <mesh position={[0, 0.22, 3.7]} castShadow>
        <boxGeometry args={[1.9, 0.12, 0.5]} />
        <meshStandardMaterial color="#8c715c" />
      </mesh>

      {/* Plantas */}
      {([-4.8, 4.85] as const).map((x, index) => (
        <group key={x} position={[x, 0, -3.2]}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <cylinderGeometry args={[0.28, 0.35, 0.65, 10]} />
            <meshStandardMaterial color="#9a7157" />
          </mesh>

          <mesh position={[0, 1.05, 0]} castShadow>
            <sphereGeometry args={[0.48, 10, 8]} />
            <meshStandardMaterial
              color={index === 0 ? "#4f9a79" : "#5da783"}
              roughness={0.95}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

function SceneContents({
  agents,
  selectedAgentId,
  onSelect,
  htmlPortal,
}: VirtualOfficeSceneProps) {
  const stations: [number, number, number][] = [
    [-3.15, 0, -0.45],
    [3.15, 0, -0.45],
    [-3.15, 0, 2.75],
    [3.15, 0, 2.75],
  ];

  return (
    <>
      <color attach="background" args={["#111a27"]} />

      <ambientLight intensity={1.35} />

      <directionalLight
        position={[5, 10, 6]}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <pointLight
        position={[-4, 4, -2]}
        intensity={0.7}
        color="#8eb8ff"
      />

      <OfficeEnvironment />

      {/* Agentes */}
      {agents.slice(0, stations.length).map((agent, index) => {
        const position = stations[index];

        if (!position) {
          return null;
        }

        return (
          <CartoonAgent
            key={agent.id}
            agent={agent}
            position={position}
            selected={selectedAgentId === agent.id}
            onSelect={() => onSelect(agent.id)}
            index={index}
            htmlPortal={htmlPortal}
          />
        );
      })}

      {/* Título do escritório */}
      <group position={[0, 2.75, -3.8]}>
        <Html
          center
          distanceFactor={10}
          transform={false}
          portal={htmlPortal}
        >
          <div className="scene-room-title">
            AGENT WORKSPACE
          </div>
        </Html>
      </group>

      {/* Controles da câmera */}
      <OrbitControls
        enablePan={false}
        minPolarAngle={0.72}
        maxPolarAngle={1.22}
        minDistance={10}
        maxDistance={19}
        target={[0, 0.7, 0]}
      />
    </>
  );
}

export function VirtualOfficeScene(
  props: Omit<VirtualOfficeSceneProps, "htmlPortal">,
) {
  const htmlPortal = useRef<HTMLElement>(null!);

  const setHtmlPortal = useCallback((element: HTMLDivElement | null) => {
  if (element) {
    htmlPortal.current = element;
  }
  }, []);

  return (
    <div
      className="office-scene"
      aria-label="Escritório virtual 3D interativo"
    >
      <div
        ref={setHtmlPortal}
        className="office-html-portal"
      />

      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{
          position: [10, 11, 13],
          fov: 45,
          near: 0.1,
          far: 100,
        }}
      >
        <SceneContents {...props} htmlPortal={htmlPortal} />
      </Canvas>

      <div className="office-scene-hint">
        Arraste para girar · Role para aproximar
      </div>
    </div>
  );
}
