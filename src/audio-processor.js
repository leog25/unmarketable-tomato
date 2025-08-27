class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const inputChannel = input[0];
            
            for (let i = 0; i < inputChannel.length; i++) {
                this.buffer[this.bufferIndex++] = inputChannel[i];
                
                if (this.bufferIndex >= this.bufferSize) {
                    // Convert float32 to int16
                    const outputBuffer = new Int16Array(this.bufferSize);
                    for (let j = 0; j < this.bufferSize; j++) {
                        outputBuffer[j] = Math.max(-32768, Math.min(32767, this.buffer[j] * 32768));
                    }
                    
                    // Send to main thread
                    this.port.postMessage({
                        type: 'audio',
                        buffer: outputBuffer.buffer
                    });
                    
                    this.bufferIndex = 0;
                }
            }
        }
        
        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);