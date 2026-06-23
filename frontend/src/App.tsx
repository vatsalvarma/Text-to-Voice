import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, Volume2, Loader2, PhoneOff } from 'lucide-react';
import './App.css';

interface Message {
  role: 'user' | 'kate' | 'system';
  content: string;
}

// Speech Recognition setup (Browser native)
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

function App() {
  const [isCallActive, setIsCallActive] = useState(false);
  const isCallActiveRef = useRef(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking' | 'transferred'>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis>(window.speechSynthesis);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const transcriptBoxRef = useRef<HTMLDivElement>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setStatus('listening');
      };

      recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const transcript = event.results[current][0].transcript;
        
        setMessages(prev => [...prev, { role: 'user', content: transcript }]);
        handleUserMessage(transcript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error !== 'no-speech' && isCallActiveRef.current) {
          setStatus('idle');
          // Try to restart listening if it wasn't a deliberate stop
          setTimeout(() => {
             if(isCallActiveRef.current && status !== 'speaking' && status !== 'processing') {
                 console.log("Restarting listening after error...");
                 startListening();
             }
          }, 1000);
        }
      };

      recognition.onend = () => {
        if (status === 'listening') {
          setStatus('idle');
        }
      };

      recognitionRef.current = recognition;
    } else {
      alert("Your browser doesn't support the native Web Speech API. Please use Google Chrome.");
    }

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (synthesisRef.current) synthesisRef.current.cancel();
    };
  }, [isCallActive]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [messages]);

  const startListening = () => {
    if (recognitionRef.current && status !== 'speaking' && status !== 'processing') {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.log("Recognition already started");
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  };

  const speak = (text: string, onEnd?: () => void) => {
    if (synthesisRef.current) {
      synthesisRef.current.cancel(); // Stop current speech
      
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance; // Keep a reference to prevent Chrome garbage collection bug
      
      // Try to find a free Indian Female English voice
      const voices = synthesisRef.current.getVoices();
      
      // Look for specific Indian female voices (Windows: Neerja/Heera, Mac: Veena) or any en-IN female
      const indianFemaleVoice = voices.find(v => 
        (v.lang === 'en-IN' || v.lang === 'hi-IN') && 
        (v.name.includes('Female') || v.name.includes('Veena') || v.name.includes('Neerja') || v.name.includes('Heera'))
      );
      
      // Fallback 1: Any Indian accent voice
      // Fallback 2: Any generic female voice
      const selectedVoice = indianFemaleVoice || 
                            voices.find(v => v.lang === 'en-IN') || 
                            voices.find(v => v.name.includes('Female'));
                            
      if (selectedVoice) utterance.voice = selectedVoice;
      
      utterance.pitch = 1.1;
      utterance.rate = 1.0;

      utterance.onstart = () => {
        setStatus('speaking');
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setStatus('idle');
        if (onEnd) {
          onEnd();
        } else if (isCallActiveRef.current) {
          // Kate finished speaking, start listening to user again
          setTimeout(startListening, 500);
        }
      };
      
      utterance.onerror = (e) => {
        console.error("Speech Synthesis Error:", e);
        setIsSpeaking(false);
        setStatus('idle');
        if (isCallActiveRef.current) {
          setTimeout(startListening, 500); // Try to fallback to listening if speech fails
        }
      }

      synthesisRef.current.speak(utterance);
      
      // Safety fallback: if onend never fires (another Chrome bug), force listen after estimated time
      const estimatedDuration = (text.length / 15) * 1000 + 2000;
      setTimeout(() => {
         if (isSpeaking && status === 'speaking') {
             console.warn("Speech Synthesis onend timeout triggered.");
             utterance.onend?.(new Event('end') as any);
         }
      }, estimatedDuration);
    }
  };

  const handleUserMessage = async (transcript: string) => {
    setStatus('processing');
    
    try {
      // Send message to our Java Backend (which calls OpenRouter)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
           message: transcript,
           history: messages // Send previous history so AI remembers context
        })
      });

      const data = await response.json();
      
      if (data.action === 'transfer_call') {
        setStatus('transferred');
        setMessages(prev => [...prev, 
          { role: 'system', content: 'Call is being transferred to a human agent...' },
          { role: 'kate', content: data.reply }
        ]);
        speak(data.reply, () => {
           endCall();
        });
        return;
      }

      if (data.action === 'end_call') {
        setMessages(prev => [...prev, { role: 'kate', content: data.reply }]);
        speak(data.reply, () => {
           endCall();
        });
        return;
      }

      // Normal reply
      setMessages(prev => [...prev, { role: 'kate', content: data.reply }]);
      speak(data.reply);

    } catch (error) {
      console.error("Error communicating with backend:", error);
      setStatus('idle');
      setMessages(prev => [...prev, { role: 'system', content: 'Connection error. Please try speaking again.' }]);
    }
  };

  const startCall = async () => {
    // 1. Instantly "unlock" Speech Synthesis for Mobile (Must be synchronous on click!)
    if (synthesisRef.current) {
       const unlockUtterance = new SpeechSynthesisUtterance('');
       unlockUtterance.volume = 0;
       synthesisRef.current.speak(unlockUtterance);
    }

    try {
      // Force the browser to show the "Turn on Microphone" prompt
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("Microphone permission denied:", err);
      alert("Please click 'Allow' when the browser asks for microphone permissions to use the voice agent.");
      return;
    }

    setIsCallActive(true);
    isCallActiveRef.current = true;
    setMessages([]);
    
    // Initial greeting from Kate (Step 1)
    const initialGreeting = "Hi, this is Kate from the appointment department at Prizmabrixx Health. Am I speaking with Sasank?";
    setMessages([{ role: 'kate', content: initialGreeting }]);
    
    // We need a slight delay to ensure voices are loaded
    setTimeout(() => {
        speak(initialGreeting);
    }, 500);
  };

  const endCall = () => {
    setIsCallActive(false);
    isCallActiveRef.current = false;
    setStatus('idle');
    stopListening();
    if (synthesisRef.current) synthesisRef.current.cancel();
    setMessages(prev => [...prev, { role: 'system', content: 'Call ended.' }]);
  };

  // Helper to determine what icon to show in the orb
  const getOrbIcon = () => {
    switch (status) {
      case 'listening': return <Mic size={48} color="white" />;
      case 'speaking': return <Volume2 size={48} color="white" />;
      case 'processing': return <Loader2 size={48} color="white" className="animate-spin" />;
      case 'transferred': return <Phone size={48} color="white" />;
      default: return <MicOff size={48} color="white" />;
    }
  };

  const getStatusText = () => {
    if (!isCallActive && messages.length === 0) return "Ready to start the call";
    if (status === 'listening') return "Kate is listening...";
    if (status === 'processing') return "Kate is thinking...";
    if (status === 'speaking') return "Kate is speaking...";
    if (status === 'transferred') return "Transferring call...";
    if (!isCallActive) return "Call Ended";
    return "Waiting for you to speak (Tap the orb to force listen)";
  };

  return (
    <div className="app-container">
      <div className="content-wrapper">
        
        {/* LEFT PANEL: Branding & Orb */}
        <div className="left-panel">
          <div className="header">
            <h1>Prizmabrixx</h1>
            <p className="subtitle">AI Appointment Assistant</p>
          </div>

          <h2 className="status-text">{getStatusText()}</h2>

          <div className="controls">
            {!isCallActive ? (
              <button className="btn btn-primary" onClick={startCall}>
                <Phone size={22} className="btn-icon" />
                Start Call
              </button>
            ) : (
              <button className="btn btn-danger" onClick={endCall}>
                <PhoneOff size={22} className="btn-icon" />
                End Call
              </button>
            )}
          </div>

          <div 
            className={`orb-container ${status}`} 
            onClick={() => {
              if (!isCallActive) {
                 startCall();
              } else if (status === 'idle') {
                 startListening();
              }
            }}
          >
            {isCallActive && (
              <>
                <div className="ripple" style={{ animationDelay: '0s' }}></div>
                <div className="ripple" style={{ animationDelay: '0.5s' }}></div>
              </>
            )}
            <div className="orb">
              {getOrbIcon()}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Transcript */}
        <div className="right-panel">
          <div className="transcript-box" ref={transcriptBoxRef}>
            {messages.length === 0 && (
              <div className="empty-state">
                 <div className="empty-icon"><Mic size={48} color="rgba(255,255,255,0.3)" /></div>
                 <p>The conversation transcript will appear here.</p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`message-wrapper ${msg.role}`}>
                <div className={`message bubble-${msg.role}`}>
                  {msg.role === 'kate' && <div className="avatar">K</div>}
                  <div className="message-content">{msg.content}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
