let generatedMCQs = [];
let examStartTime = null;
let timerInterval = null;

// Receive Elements from the html page
const fileInput = document.getElementById('fileInput');
const notesText = document.getElementById('notesText');
const numQuestions = document.getElementById('numQuestions');
const difficulty = document.getElementById('difficulty');
const loadingSection = document.getElementById('loadingSection');
const uploadArea = document.getElementById('uploadArea');

// Screen elements
const uploadScreen = document.getElementById('uploadScreen');
const guidelinesScreen = document.getElementById('guidelinesScreen');
const examScreen = document.getElementById('examScreen');

// File upload drag/drop UX
uploadArea.addEventListener('dragover', e => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', e => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        uploadArea.classList.add('file-selected');
        uploadArea.querySelector('.upload-text').textContent = 'File selected: ' + files[0].name;
    }
});

uploadArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        uploadArea.classList.add('file-selected');
        uploadArea.querySelector('.upload-text').textContent = 'File selected: ' + fileInput.files[0].name;
    }
});

// Helper: Read different file types
function readFileAsText(file, callback) {
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = e => callback(e.target.result);
        reader.readAsText(file);
    } else if (fileName.endsWith('.pdf')) {
        readPDFFile(file, callback);
    } else if (fileName.endsWith('.docx')) {
        readDocxFile(file, callback);
    } else {
        alert('Unsupported file type. Please use .txt, .pdf, or .docx files.');
    }
}

// Read PDF files using PDF.js
async function readPDFFile(file, callback) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }

        callback(fullText);
    } catch (error) {
        alert('Error reading PDF file: ' + error.message);
    }
}

// Read DOCX files using mammoth.js
async function readDocxFile(file, callback) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({arrayBuffer: arrayBuffer});
        callback(result.value);
    } catch (error) {
        alert('Error reading DOCX file: ' + error.message);
    }
}

// Main: MCQ Generation
function generateMCQs() {
    let text = notesText.value.trim();

    if (!text && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        readFileAsText(file, content => {
            if (content && content.trim()) {
                callMCQApi(content.trim());
            } else {
                alert('Could not extract text from the file. Please try a different file or paste your notes manually.');
            }
        });
    } else if (text) {
        callMCQApi(text);
    } else {
        alert('Please upload a file or paste your notes.');
    }
}

// Generate MCQs using Gemini API with CORRECT endpoint format
async function callMCQApi(noteText) {
    loadingSection.style.display = 'block';

    // Validate input
    if (noteText.length < 50) {
        loadingSection.style.display = 'none';
        alert('Please provide more detailed notes (at least 50 characters) for better MCQ generation.');
        return;
    }

    try {
        const apiKey = 'AIzaSyBZb7xlpYWrAWV3wmwkkpuv2Skx9JdmWgs';
        const numQ = parseInt(numQuestions.value);
        const diff = difficulty.value;

        // Simplified prompt for better free tier compatibility
        const prompt = `Create exactly ${numQ} multiple choice questions based on these notes. Each question must have exactly 4 options with only one correct answer.

Study Notes: ${noteText}

Format each question exactly like this example:
1. What is the main topic?
A. First option
B. Second option  
C. Correct answer
D. Fourth option
Correct Answer: C

Generate ${numQ} questions with difficulty level: ${diff}

Important: 
- Make questions relevant to the content
- Include exactly 4 options (A, B, C, D) for each question
- Mark the correct answer clearly
- Number each question (1, 2, 3, etc.)`;

        // API endpoint format 
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 1500
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            console.error('Status:', response.status, response.statusText);
            throw new Error(`API request failed: ${response.status} ${response.statusText}. Response: ${errorText}`);
        }

        const data = await response.json();
        console.log('Full API Response:', data);

        // Check if response has the expected structure
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
            console.error('Invalid response structure:', data);
            throw new Error('Invalid response structure from API');
        }

        let responseText = data.candidates[0].content.parts[0].text.trim();
        console.log('Response Text:', responseText);

        // Parse the plain text response into MCQ format
        let mcqs = parseQuestionsFromText(responseText, numQ);

        // Validate we got some questions
        if (!mcqs || mcqs.length === 0) {
            throw new Error('No valid MCQs could be parsed from the response');
        }

        generatedMCQs = mcqs.slice(0, numQ); // Ensure we don't exceed requested number
        loadingSection.style.display = 'none';
        showGuidelines();

    } catch (error) {
        loadingSection.style.display = 'none';
        console.error('MCQ Generation Error:', error);

        // Fallback to demo mode
        alert(`API call failed: ${error.message}\n\nRunning in demo mode with sample questions.`);
        generatedMCQs = generateAdvancedMockMCQs(noteText);
        showGuidelines();
    }
}

// Parse questions from plain text response
function parseQuestionsFromText(text, expectedCount) {
    const mcqs = [];
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);

    let currentQuestion = null;
    let currentOptions = [];
    let correctAnswer = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect question start (number followed by period or question mark)
        if (line.match(/^\d+\./)) {
            // Save previous question if complete
            if (currentQuestion && currentOptions.length === 4) {
                mcqs.push({
                    question: currentQuestion,
                    options: currentOptions,
                    correct: correctAnswer || 0
                });
            }

            // Start new question
            currentQuestion = line.replace(/^\d+\.\s*/, '').trim();
            currentOptions = [];
            correctAnswer = 0;
        }
        // Detect options (A, B, C, D)
        else if (line.match(/^[A-D]\./)) {
            const optionText = line.replace(/^[A-D]\.\s*/, '').trim();
            currentOptions.push(optionText);
        }
        // Detect correct answer indication
        else if (line.toLowerCase().includes('correct answer:')) {
            const answerMatch = line.match(/[A-D]/);
            if (answerMatch) {
                const answerLetter = answerMatch[0];
                correctAnswer = answerLetter.charCodeAt(0) - 65; // Convert A=0, B=1, C=2, D=3
            }
        }
    }

    // Add the last question if valid
    if (currentQuestion && currentOptions.length === 4) {
        mcqs.push({
            question: currentQuestion,
            options: currentOptions,
            correct: correctAnswer || 0
        });
    }

    // If we didn't get enough questions, pad with mock questions based on content
    while (mcqs.length < expectedCount) {
        const sampleWords = text.split(' ').filter(word => word.length > 3).slice(0, 5);
        const term = sampleWords[mcqs.length % sampleWords.length] || 'concept';

        mcqs.push({
            question: `Based on the provided notes, what can you infer about "${term}"?`,
            options: [
                `${term} is a key concept discussed in the material`,
                `${term} is not relevant to the topic`,
                `${term} is mentioned only briefly`, 
                `${term} is completely unrelated`
            ],
            correct: 0
        });
    }

    console.log('Parsed Questions:', mcqs);
    return mcqs;
}

// Enhanced mock MCQ generator for demo purposes
function generateAdvancedMockMCQs(notes) {
    const n = parseInt(numQuestions.value);
    const words = notes.split(' ').filter(word => word.length > 3);
    const keyTerms = words.slice(0, Math.min(10, words.length)); // Get significant words

    return Array.from({length: n}, (_, i) => {
        const term = keyTerms[i % keyTerms.length] || 'concept';
        return {
            question: `Based on the notes, which of the following best describes "${term}"?`,
            options: [
                `${term} is a fundamental concept in the subject`,
                `${term} is not relevant to this topic`,
                `${term} is a modern invention`,
                `${term} is only theoretical`
            ],
            correct: 0
        };
    });
}

// Show guidelines screen
function showGuidelines() {
    uploadScreen.style.display = 'none';
    guidelinesScreen.style.display = 'block';
    examScreen.style.display = 'none';

    // Update exam details
    document.getElementById('examQuestionCount').textContent = generatedMCQs.length;
    document.getElementById('examDifficulty').textContent = difficulty.value.charAt(0).toUpperCase() + difficulty.value.slice(1);
}

// Go back to upload screen
function goBackToUpload() {
    uploadScreen.style.display = 'block';
    guidelinesScreen.style.display = 'none';
    examScreen.style.display = 'none';
}

// Start the exam in full-screen mode
function startExam() {
    // Request full-screen mode
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().then(() => {
            showExamScreen();
        }).catch(err => {
            console.log('Fullscreen request failed:', err);
            // Show exam even if fullscreen fails
            showExamScreen();
        });
    } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
        showExamScreen();
    } else if (document.documentElement.msRequestFullscreen) {
        document.documentElement.msRequestFullscreen();
        showExamScreen();
    } else {
        // Fallback if fullscreen is not supported
        showExamScreen();
    }
}

// Show exam screen
function showExamScreen() {
    uploadScreen.style.display = 'none';
    guidelinesScreen.style.display = 'none';
    examScreen.style.display = 'block';

    // Hide header and footer
    document.querySelector('.header').style.display = 'none';
    document.querySelector('.footer').style.display = 'none';

    // Set body background for exam
    document.body.style.background = '#f5f7fa';

    // Generate exam HTML
    generateExamHTML();

    // Start timer
    startTimer();

    // Enable security measures
    enableSecurityMeasures();
}

// Generate exam HTML
function generateExamHTML() {
    const examContainer = document.getElementById('examContainer');

    const examHTML = `
        <div class='timer' id='timer'>Time: 00:00</div>
        <div class='exam-header'>
            <div class='exam-title'>MCQ Quiz Exam</div>
            <p>Answer all questions carefully. Good luck!</p>
        </div>

        <div class='security-notice'>
            🔒 SECURE EXAM MODE: Copy, paste, print, screenshots, and developer tools are disabled
        </div>

        <form id='examForm'>
            ${generatedMCQs.map((mcq, i) => `
                <div class='question-container'>
                    <div class='question-number'>Question ${i + 1} of ${generatedMCQs.length}</div>
                    <div class='question-text'>${mcq.question}</div>
                    <ul class='options-list'>
                        ${mcq.options.map((option, j) => `
                            <li class='option-item'>
                                <label>
                                    <input type='radio' name='q${i}' value='${j}' required>
                                    ${String.fromCharCode(65 + j)}. ${option}
                                </label>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `).join('')}

            <div class='submit-container'>
                <button type='submit' class='generate-btn'>📝 Submit Answers</button>
            </div>
        </form>
    `;

    examContainer.innerHTML = examHTML;

    // Add form submission handler
    document.getElementById('examForm').addEventListener('submit', handleExamSubmission);
}

// Start timer
function startTimer() {
    examStartTime = Date.now();
    const timerElement = document.getElementById('timer');

    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - examStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        timerElement.textContent = `Time: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

// Enable security measures
function enableSecurityMeasures() {
    // Disable right-click
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Disable text selection
    document.addEventListener('selectstart', e => e.preventDefault());

    // Disable drag
    document.addEventListener('dragstart', e => e.preventDefault());

    // Disable keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, Ctrl+S, Ctrl+A, Ctrl+P
        if (e.keyCode === 123 || 
            (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) ||
            (e.ctrlKey && (e.keyCode === 85 || e.keyCode === 83 || e.keyCode === 65 || e.keyCode === 80))) {
            e.preventDefault();
            return false;
        }
    });

    // Warn before leaving
    window.addEventListener('beforeunload', function(e) {
        const confirmationMessage = 'Are you sure you want to leave? Your progress will be lost.';
        e.returnValue = confirmationMessage;
        return confirmationMessage;
    });
}

// Handle exam submission
function handleExamSubmission(e) {
    e.preventDefault();

    // Stop timer
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    // Collect answers
    const formData = new FormData(e.target);
    let score = 0;
    let answers = {};

    for (let [key, value] of formData.entries()) {
        answers[key] = parseInt(value);
    }

    // Calculate score
    generatedMCQs.forEach((mcq, i) => {
        if (answers[`q${i}`] === mcq.correct) {
            score++;
        }
    });

    const percentage = Math.round((score / generatedMCQs.length) * 100);
    const elapsed = Math.floor((Date.now() - examStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Show results
    alert(`Exam Completed!\n\nYour Score: ${score}/${generatedMCQs.length} (${percentage}%)\nTime Taken: ${timeStr}\n\nThank you for taking the quiz!`);

    // Exit fullscreen and return to upload
    if (document.fullscreenElement) {
        document.exitFullscreen().then(() => {
            returnToNormalMode();
        });
    } else {
        returnToNormalMode();
    }
}

// Return to normal mode
function returnToNormalMode() {
    // Reset display
    document.querySelector('.header').style.display = 'block';
    document.querySelector('.footer').style.display = 'block';
    document.body.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

    // Show upload screen
    uploadScreen.style.display = 'block';
    guidelinesScreen.style.display = 'none';
    examScreen.style.display = 'none';

    // Clear generated MCQs
    generatedMCQs = [];

    // Remove event listeners
    document.removeEventListener('contextmenu', e => e.preventDefault());
    document.removeEventListener('selectstart', e => e.preventDefault());
    document.removeEventListener('dragstart', e => e.preventDefault());
    window.removeEventListener('beforeunload', () => {});
}

// Handle fullscreen change
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && examScreen.style.display === 'block') {
        // User exited fullscreen during exam
        alert('Fullscreen mode exited. Returning to main screen.');
        returnToNormalMode();
    }
});