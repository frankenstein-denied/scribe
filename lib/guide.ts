export type GuideRole = 'Student' | 'Professor'
export type GuideStep = { title: string; body: string; image: string; alt: string }

export const GUIDE: Record<GuideRole, { intro: string; steps: GuideStep[] }> = {
  Student: {
    intro: 'Any @sorsu.edu.ph Google account can sign in as a student. No setup needed.',
    steps: [
      { title: 'Sign in as a Student', body: 'Open SCRIBE, choose “Student” on the sign-in card, then click “Continue with Google” and pick your @sorsu.edu.ph account.', image: '/guide/student-1-login.png', alt: 'SCRIBE sign-in card with the Student option selected' },
      { title: 'Ask SCRIBE a question', body: 'On the Ask SCRIBE page, type your question in the prompt bar at the bottom and press Enter. Use the subject menu beside it to limit answers to one subject.', image: '/guide/student-2-ask.png', alt: 'Ask SCRIBE page with the prompt bar' },
      { title: 'Read answers and check sources', body: 'Each answer is a numbered cell quoting your professors’ uploaded materials. Click a cell’s source to see the exact passage and page it came from.', image: '/guide/student-3-answer.png', alt: 'An answer cell with its source passage open' },
      { title: 'Turn answers into a quiz', body: 'Click “Create quiz”, tick the cells you want to study, then name the quiz. It is saved to your Study sets.', image: '/guide/student-4-quiz.png', alt: 'Selecting answer cells to create a quiz' },
      { title: 'Review your Study sets', body: 'Open “Study sets” in the left sidebar to take your saved quizzes and see your scores.', image: '/guide/student-5-study-sets.png', alt: 'Study sets page listing saved quizzes' },
      { title: 'Explore My 2nd brain', body: 'Open “My 2nd brain” to see a map of your sessions, quizzes and the files they came from.', image: '/guide/student-6-brain.png', alt: 'My 2nd brain knowledge graph' },
      { title: 'Chat with the SCRIBE assistant', body: 'On Study sets and My 2nd brain, click the SCRIBE avatar at the bottom-right for quick answers without leaving the page.', image: '/guide/student-7-assistant.png', alt: 'The floating SCRIBE assistant chat open' },
    ],
  },
  Professor: {
    intro: 'Instructor access is for verified CICT faculty. Ask your CICT admin to add your @sorsu.edu.ph email to the verified instructors list first.',
    steps: [
      { title: 'Sign in as a Professor / Instructor', body: 'Open SCRIBE, choose “Professor / Instructor” on the sign-in card, then click “Continue with Google” with your verified @sorsu.edu.ph account.', image: '/guide/professor-1-login.png', alt: 'SCRIBE sign-in card with the Professor option selected' },
      { title: 'Upload your materials', body: 'On “My materials”, upload lecture files (PDF, PPTX or DOCX). SCRIBE reads them so students get answers grounded in your materials.', image: '/guide/professor-2-materials.png', alt: 'My materials page with uploaded files' },
      { title: 'Check processing status', body: 'Each file shows its status and the topics SCRIBE found. Files marked Ready are searchable by students.', image: '/guide/professor-3-status.png', alt: 'Uploaded file cards with status and topic tags' },
      { title: 'See the Knowledge graph', body: 'Open “Knowledge graph” in the sidebar to see how your files connect through shared topics and subjects.', image: '/guide/professor-4-graph.png', alt: 'Instructor knowledge graph view' },
      { title: 'Ask your teaching assistant', body: 'Click the SCRIBE avatar at the bottom-right to ask about your own uploads, such as which topics your files cover.', image: '/guide/professor-5-assistant.png', alt: 'SCRIBE teaching assistant chat open on the instructor page' },
      { title: 'Try Ask SCRIBE as a student would', body: 'Click “Ask SCRIBE” in the sidebar to ask questions the way your students do and check what they will see.', image: '/guide/professor-6-ask.png', alt: 'Ask SCRIBE page opened from the instructor sidebar' },
    ],
  },
}
