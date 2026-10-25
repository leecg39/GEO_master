import { getDatabase } from '../../../src/lib/db';
import { storeGeneratedContent } from '../../../src/lib/contents';
import { knowledgeDocuments, writingProfiles } from '../../../src/lib/library';
import { requireActiveProject } from '../../../src/lib/projects';
if (process.env.GEO_DB_PATH !== '/tmp/geo-halo-implementation-qa.db') throw new Error('QA DB only');
const project = requireActiveProject();
const doc = knowledgeDocuments.create({ name: '삭제될 QA 참고 자료', body: '당시 보존된 QA 자료입니다.' });
const profile = writingProfiles.create({ name: '삭제될 QA 페르소나', audience: '실무자', tone: '간결하게' });
const context = { projectId: project.id, writingProfile: profile, knowledgeDocuments: [doc], facts: [], opportunity: null };
const content = storeGeneratedContent({ tool: 'intro', title: 'QA · 삭제된 자료를 사용했던 초안', status: 'draft', provider: null,
  input: { action: 'intro', topic: 'QA 이력 재선택 검증', writingProfileId: profile.id, knowledgeDocumentIds: [doc.id], generationContext: context },
  output: { intro: 'QA 전용 저장 콘텐츠입니다. 실제 LLM 생성 결과가 아닙니다.', generationContext: context }, metadata: { qa: true }, origin: 'generated' });
knowledgeDocuments.delete(doc.id, { expectedUpdatedAt: doc.updatedAt });
writingProfiles.delete(profile.id, { expectedUpdatedAt: profile.updatedAt });
getDatabase().sqlite.prepare('DELETE FROM measure_runs WHERE id = 3').run();
console.log({ contentId: content.id, deletedDocumentId: doc.id, deletedProfileId: profile.id, deletedFollowupRunId: 3 });
