import { createContext, useContext, type Accessor } from 'solid-js';

/** The project a pane shows, for everything inside it. */
export interface ProjectScope {
  /** Its folder: its id in every call to main. */
  dir: string;
  name: string;
  /** Whether its pane is on screen: its terminals fit, and take the focus, only then. */
  shown: Accessor<boolean>;
  /** Its pane's width, which the columns in it are clamped to. */
  width: Accessor<number>;
}

export const ProjectContext = createContext<ProjectScope>();

export function useProject(): ProjectScope {
  const scope = useContext(ProjectContext);
  if (!scope) throw new Error('Used outside a project pane');
  return scope;
}
