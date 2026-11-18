import type { ChangedFile } from '../../../shared/types';
import { statusLetter } from './diffText';
import LineCounts from './LineCounts';

/** A changed-files row's status letter, path and counts, as the panel and the diff window both list them. app.css's `.file-list .path > span` cuts the path from its start. */
export default function FileRowContent(props: { file: ChangedFile }) {
  return (
    <>
      <span class="st" data-st={props.file.status}>
        {statusLetter(props.file.status)}
      </span>
      <span class="path" title={props.file.path}>
        <span>{props.file.path}</span>
      </span>
      <LineCounts added={props.file.added} removed={props.file.removed} />
    </>
  );
}
