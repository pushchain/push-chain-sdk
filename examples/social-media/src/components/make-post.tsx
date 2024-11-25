import React, { useState } from 'react';
import { usePostMessage } from '../hooks/usePostMessage.tsx';

export function MakePost() {
  const [openModal, setOpenModal] = useState(false);
  const sendPost = usePostMessage();

  async function handleSubmitPost(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    try {
      event.preventDefault();
      const formData = new FormData(event.target as HTMLFormElement);
      const message = formData.get('message')?.toString();
      if (message) {
        await sendPost.mutateAsync(message);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setOpenModal(false);
    }
  }

  function Modal() {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
        <div className="relative bg-white shadow-xl rounded p-4 w-96 flex flex-col items-end">
          <button
            className="text-gray-500 hover:text-gray-700 text-xl"
            onClick={() => setOpenModal(false)}
          >
            &times;
          </button>
          <form onSubmit={handleSubmitPost} className="w-full">
          <textarea
            id="message"
            name="message"
            placeholder="What are you thinking?"
            rows={3}
            maxLength={140}
            required
            title="Post should have less than 140 characters"
            className="w-full p-2 border border-gray-300 rounded mb-4"
          ></textarea>
            <button
              type="submit"
              className="bg-blue-500 text-white p-2 rounded hover:bg-blue-700 w-full"
              disabled={sendPost.isPending}
            >
              {sendPost.isPending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        className="bg-blue-500 px-2 text-white text-md rounded hover:bg-blue-700 mt-2 h-fit"
        onClick={() => setOpenModal(!openModal)}
      >
        Create post
      </button>
      {openModal && <Modal/>}
    </>
  );
}