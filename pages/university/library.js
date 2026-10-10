import Link from 'next/link';
import { useState } from 'react';
import { universityPageProps } from '../../lib/universityPage';
import { getLibrary } from '../../lib/university';
import UniversityShell, { accountFromProps } from '../../components/university/UniversityShell';
import BackButton from '../../components/BackButton';
import { FileRow } from '../../components/university/LessonBits';

// Every downloadable file across every course, filterable by type and
// department. Each row says which lesson teaches how to use it.
export async function getServerSideProps(ctx) {
  return universityPageProps(ctx, () => getLibrary());
}

const TYPE_LABEL = { pdf: 'PDF', xlsx: 'Spreadsheet', csv: 'CSV', docx: 'Editable doc', txt: 'Text', fdx: 'Script file', pptx: 'Slides', zip: 'Zip', img: 'Image', lut: 'LUT', audio: 'Audio', project: 'Project file', other: 'Other' };

export default function LibraryPage(props) {
  const files = props.files || [];
  const types = props.types || [];
  const departments = props.departments || [];
  const [type, setType] = useState(null);
  const [dept, setDept] = useState(null);
  const visible = files.filter((f) => (!type || f.fileType === type) && (!dept || f.topicName === dept));

  return (
    <UniversityShell title="Library" description="Templates, worksheets and sample files from every Film University course." account={accountFromProps(props)} mainGenres={props.mainGenres} wide>
      <div className="uni-topbar">
        <BackButton fallbackHref="/university" />
        <nav className="uni-crumbs" aria-label="Breadcrumb"><Link href="/university">Film University</Link><span>/</span><span>Library</span></nav>
      </div>
      <div>
        <h1 className="uni-h1" style={{ fontSize: '1.9rem' }}>Library</h1>
        <p className="uni-lead" style={{ marginBottom: 0 }}>Templates, worksheets and sample files from every course. Download, fill in, shoot.</p>
      </div>

      {files.length === 0 ? (
        <div className="uni-empty">{props.loadError ? 'Film University isn’t set up yet.' : 'No files yet — they arrive with the first courses.'}</div>
      ) : (
        <>
          <div className="uni-chips">
            <button type="button" className={`uni-chip${!type ? ' on' : ''}`} onClick={() => setType(null)}>All {files.length}</button>
            {types.map((t) => <button key={t.value} type="button" className={`uni-chip${type === t.value ? ' on' : ''}`} onClick={() => setType(type === t.value ? null : t.value)}>{TYPE_LABEL[t.value] || t.value} {t.count}</button>)}
            {departments.length > 1 && <span className="uni-chip-gap" />}
            {departments.length > 1 && departments.map((d) => <button key={d.id} type="button" className={`uni-chip${dept === d.name ? ' on' : ''}`} onClick={() => setDept(dept === d.name ? null : d.name)}>{d.name}</button>)}
          </div>
          <div className="uni-files">
            {visible.map((f) => <FileRow key={f.id} file={f} showCourse />)}
          </div>
          {visible.length === 0 && <div className="uni-empty">Nothing matches those filters.</div>}
        </>
      )}
    </UniversityShell>
  );
}
