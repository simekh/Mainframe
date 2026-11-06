/** How the new-task dialog and the manager's start_task both word how far ahead of its base the branch is. */
export const commitsThatArent = (n: number) => (n === 1 ? "1 commit that isn't" : `${n} commits that aren't`);
